//! The subset of node-semver that parseVersions relies on: strict
//! `semver.valid` and `semver.compare` ordering.

use std::cmp::Ordering;

use crate::packument::is_js_whitespace;

/// node-semver's MAX_LENGTH for a version string.
const MAX_LENGTH: usize = 256;
const MAX_SAFE_INTEGER: &str = "9007199254740991";

/// `/^[0-9]+\.[0-9]+\.[0-9]+$/`: the stable-version filter in parseVersions.
/// Leading zeros are allowed here, exactly like the regex.
pub fn is_strict_triple(s: &str) -> bool {
  let mut parts = 0;
  for part in s.split('.') {
    if part.is_empty() || !part.bytes().all(|b| b.is_ascii_digit()) {
      return false;
    }
    parts += 1;
  }
  parts == 3
}

#[derive(Debug, PartialEq, Eq)]
enum Identifier<'a> {
  Numeric(&'a str),
  Alphanumeric(&'a str),
}

/// A parsed version borrowing its parts from the key. Build metadata is
/// validated but dropped: semver.compare ignores it.
#[derive(Debug)]
pub struct Version<'a> {
  core: [&'a str; 3],
  prerelease: Vec<Identifier<'a>>,
}

impl<'a> Version<'a> {
  /// For keys that already passed `is_strict_triple`.
  pub fn from_triple(s: &'a str) -> Self {
    let mut parts = s.splitn(3, '.');
    let mut next = || parts.next().unwrap_or("0");
    Version {
      core: [next(), next(), next()],
      prerelease: Vec::new(),
    }
  }

  /// `semver.valid(input) !== null` under node-semver's strict FULL grammar:
  /// optional `v`, no leading zeros, core numbers <= MAX_SAFE_INTEGER.
  pub fn parse(input: &'a str) -> Option<Self> {
    if input.len() > MAX_LENGTH {
      return None;
    }
    let s = input.trim_matches(is_js_whitespace);
    let s = s.strip_prefix('v').unwrap_or(s);
    let (rest, build) = match s.split_once('+') {
      Some((rest, build)) => (rest, Some(build)),
      None => (s, None),
    };
    if build.is_some_and(|b| !b.split('.').all(is_build_identifier)) {
      return None;
    }
    let (core, prerelease) = match rest.split_once('-') {
      Some((core, prerelease)) => (core, Some(prerelease)),
      None => (rest, None),
    };

    let mut parts = core.split('.');
    let core = [parts.next()?, parts.next()?, parts.next()?];
    if parts.next().is_some() {
      return None;
    }
    let in_range = |n: &&str| is_numeric_identifier(n) && cmp_numeric(n, MAX_SAFE_INTEGER).is_le();
    if !core.iter().all(in_range) {
      return None;
    }

    let mut identifiers = Vec::new();
    for id in prerelease.into_iter().flat_map(|p| p.split('.')) {
      identifiers.push(if is_numeric_identifier(id) {
        Identifier::Numeric(id)
      } else if is_alphanumeric_identifier(id) {
        Identifier::Alphanumeric(id)
      } else {
        return None;
      });
    }
    Some(Version {
      core,
      prerelease: identifiers,
    })
  }

  pub fn is_prerelease(&self) -> bool {
    !self.prerelease.is_empty()
  }

  /// semver.compare: core numbers, then a release outranks its prereleases,
  /// then identifiers pairwise (numeric < alphanumeric), then length.
  pub fn compare(&self, other: &Self) -> Ordering {
    let core = self
      .core
      .iter()
      .zip(&other.core)
      .map(|(a, b)| cmp_numeric(a, b));
    if let Some(ordering) = core.into_iter().find(|o| o.is_ne()) {
      return ordering;
    }
    match (self.is_prerelease(), other.is_prerelease()) {
      (false, false) => Ordering::Equal,
      (true, false) => Ordering::Less,
      (false, true) => Ordering::Greater,
      (true, true) => {
        for (a, b) in self.prerelease.iter().zip(&other.prerelease) {
          let ordering = match (a, b) {
            (Identifier::Numeric(x), Identifier::Numeric(y)) => cmp_numeric(x, y),
            (Identifier::Numeric(_), Identifier::Alphanumeric(_)) => Ordering::Less,
            (Identifier::Alphanumeric(_), Identifier::Numeric(_)) => Ordering::Greater,
            (Identifier::Alphanumeric(x), Identifier::Alphanumeric(y)) => x.cmp(y),
          };
          if ordering.is_ne() {
            return ordering;
          }
        }
        self.prerelease.len().cmp(&other.prerelease.len())
      }
    }
  }
}

/// `0|[1-9]\d*`
fn is_numeric_identifier(s: &str) -> bool {
  !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()) && (s == "0" || !s.starts_with('0'))
}

/// `\d*[a-zA-Z-][a-zA-Z0-9-]*`
fn is_alphanumeric_identifier(s: &str) -> bool {
  s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
    && s.bytes().any(|b| b.is_ascii_alphabetic() || b == b'-')
}

/// `[a-zA-Z0-9-]+`
fn is_build_identifier(s: &str) -> bool {
  !s.is_empty() && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

/// Numeric order of two digit strings of any length, without overflow.
/// node-semver compares as doubles, which only differs past 2^53.
fn cmp_numeric(a: &str, b: &str) -> Ordering {
  let a = a.trim_start_matches('0');
  let b = b.trim_start_matches('0');
  a.len().cmp(&b.len()).then_with(|| a.cmp(b))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn semver_spec_precedence() {
    // https://semver.org/#spec-item-11, ascending.
    let ordered = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
      "1.0.1",
      "1.1.0",
      "2.0.0",
      "10.0.0",
    ];
    for pair in ordered.windows(2) {
      let (a, b) = (
        Version::parse(pair[0]).unwrap(),
        Version::parse(pair[1]).unwrap(),
      );
      assert_eq!(a.compare(&b), Ordering::Less, "{} < {}", pair[0], pair[1]);
      assert_eq!(
        b.compare(&a),
        Ordering::Greater,
        "{} > {}",
        pair[1],
        pair[0]
      );
    }
  }

  #[test]
  fn build_metadata_does_not_affect_order() {
    let a = Version::parse("1.0.0-rc.1+build.1").unwrap();
    let b = Version::parse("1.0.0-rc.1+build.2").unwrap();
    assert_eq!(a.compare(&b), Ordering::Equal);
  }

  #[test]
  fn strict_grammar_matches_semver_valid() {
    let valid = [
      "1.2.3",
      "v1.2.3",
      " 1.2.3 ",
      "1.2.3-0a",
      "1.2.3-a-b.1",
      "1.2.3+b.1",
      "9007199254740991.0.0",
    ];
    for version in valid {
      assert!(Version::parse(version).is_some(), "{version}");
    }
    let invalid = [
      "01.2.3",
      "1.2",
      "1.2.3.4",
      "1.2.3-01",
      "1.2.3-",
      "1.2.3-a..b",
      "1.2.3+",
      "1.2.3+a+b",
      "V1.2.3",
      "9007199254740992.0.0",
      "1.2.3-\u{e9}",
    ];
    for version in invalid {
      assert!(Version::parse(version).is_none(), "{version}");
    }
    assert!(Version::parse(&format!("1.2.3-{}", "a".repeat(260))).is_none());
  }

  #[test]
  fn strict_triple_filter_matches_the_regex() {
    assert!(is_strict_triple("1.2.3") && is_strict_triple("01.02.03"));
    for s in ["1.2", "1.2.3-a", "1.2.3+b", "v1.2.3", "1..3", "1.2.3."] {
      assert!(!is_strict_triple(s), "{s}");
    }
  }
}
