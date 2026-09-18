//! Streaming packument parse: only `versions` keys and the latest version's
//! `deprecated` / `engines` are materialized; everything else is skipped.

use std::borrow::Cow;
use std::collections::HashMap;
use std::fmt;

use serde::de::{self, DeserializeSeed, Deserializer, IgnoredAny, MapAccess, SeqAccess, Visitor};
use serde::Deserialize;
use serde_json::value::RawValue;

use crate::semver::{is_strict_triple, Version};
use crate::{Error, Parsed};

/// `versions` in document order: (version key, unparsed manifest).
type Entries<'a> = Vec<(Cow<'a, str>, &'a RawValue)>;

/// Port of `parseVersions(raw)` from src/shared/versions.ts.
pub fn parse_versions(bytes: &[u8]) -> Result<Parsed, Error> {
  // Buffer#toString('utf8') replaces invalid sequences the same way.
  let text = String::from_utf8_lossy(bytes);
  let mut de = serde_json::Deserializer::from_str(&text);
  let entries = de.deserialize_any(VersionsField).map_err(json_error)?;
  de.end().map_err(json_error)?;

  let mut stable = Vec::new();
  let mut prerelease = Vec::new();
  for (key, _) in &entries {
    if is_strict_triple(key) {
      stable.push((Version::from_triple(key), key.as_ref()));
    } else if let Some(version) = Version::parse(key).filter(Version::is_prerelease) {
      prerelease.push((version, key.as_ref()));
    }
  }
  // Stable sorts, descending: Array#sort(semver.rcompare) keeps ties in order.
  stable.sort_by(|a, b| b.0.compare(&a.0));
  prerelease.sort_by(|a, b| b.0.compare(&a.0));

  let latest = stable
    .first()
    .or(prerelease.first())
    .map_or("unknown", |(_, key)| *key);
  let manifest = entries
    .iter()
    .find(|(key, _)| key == latest)
    .and_then(|(_, raw)| serde_json::from_str::<Manifest>(raw.get()).ok());

  Ok(Parsed {
    latest_version: latest.to_owned(),
    all_versions: stable.iter().map(|(_, key)| (*key).to_owned()).collect(),
    prerelease_versions: prerelease
      .iter()
      .map(|(_, key)| (*key).to_owned())
      .collect(),
    deprecated: manifest
      .as_ref()
      .and_then(|m| m.deprecated)
      .and_then(normalize_deprecated),
    engines_node: manifest
      .as_ref()
      .and_then(|m| m.engines)
      .and_then(extract_engines_node),
  })
}

fn json_error(e: serde_json::Error) -> Error {
  Error(format!("invalid packument JSON: {e}"))
}

#[derive(Deserialize)]
struct Manifest<'a> {
  #[serde(borrow, default)]
  deprecated: Option<&'a RawValue>,
  #[serde(borrow, default)]
  engines: Option<&'a RawValue>,
}

/// normalizeDeprecatedMessage from src/shared/manifest.ts.
fn normalize_deprecated(raw: &RawValue) -> Option<String> {
  match raw.get() {
    "true" => Some("This version is deprecated.".to_owned()),
    json => non_blank_string(json),
  }
}

/// extractEnginesNode from src/shared/manifest.ts.
fn extract_engines_node(raw: &RawValue) -> Option<String> {
  #[derive(Deserialize)]
  struct Engines<'a> {
    #[serde(borrow, default)]
    node: Option<&'a RawValue>,
  }
  if !raw.get().starts_with('{') {
    return None;
  }
  let engines: Engines = serde_json::from_str(raw.get()).ok()?;
  non_blank_string(engines.node?.get())
}

/// A JSON string value whose String#trim() is non-empty.
fn non_blank_string(json: &str) -> Option<String> {
  if !json.starts_with('"') {
    return None;
  }
  let value: String = serde_json::from_str(json).ok()?;
  value.chars().any(|c| !is_js_whitespace(c)).then_some(value)
}

/// What String#trim strips: ECMAScript WhiteSpace + LineTerminator. Differs
/// from char::is_whitespace (U+0085 is not JS whitespace, U+FEFF is).
pub(crate) fn is_js_whitespace(c: char) -> bool {
  matches!(
    c,
    '\t' | '\n' | '\u{B}' | '\u{C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'
      ..='\u{200A}' | '\u{2028}' | '\u{2029}' | '\u{202F}' | '\u{205F}' | '\u{3000}' | '\u{FEFF}'
  )
}

// --- serde plumbing ------------------------------------------------------------

/// Visits of non-objects yield no entries, the way `data.versions || {}` plus
/// Object.keys treats primitives and arrays.
macro_rules! non_object_is_empty {
  () => {
    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
      while seq.next_element::<IgnoredAny>()?.is_some() {}
      Ok(Vec::new())
    }
    fn visit_bool<E>(self, _: bool) -> Result<Self::Value, E> {
      Ok(Vec::new())
    }
    fn visit_i64<E>(self, _: i64) -> Result<Self::Value, E> {
      Ok(Vec::new())
    }
    fn visit_u64<E>(self, _: u64) -> Result<Self::Value, E> {
      Ok(Vec::new())
    }
    fn visit_f64<E>(self, _: f64) -> Result<Self::Value, E> {
      Ok(Vec::new())
    }
    fn visit_str<E>(self, _: &str) -> Result<Self::Value, E> {
      Ok(Vec::new())
    }
    fn visit_unit<E>(self) -> Result<Self::Value, E> {
      Ok(Vec::new())
    }
  };
}

/// A map key that borrows from the input unless it contains escapes.
struct Key<'a>(Cow<'a, str>);

impl<'de> de::Deserialize<'de> for Key<'de> {
  fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
    struct KeyVisitor;
    impl<'de> Visitor<'de> for KeyVisitor {
      type Value = Key<'de>;
      fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a string key")
      }
      fn visit_borrowed_str<E>(self, v: &'de str) -> Result<Self::Value, E> {
        Ok(Key(Cow::Borrowed(v)))
      }
      fn visit_str<E>(self, v: &str) -> Result<Self::Value, E> {
        Ok(Key(Cow::Owned(v.to_owned())))
      }
    }
    deserializer.deserialize_str(KeyVisitor)
  }
}

/// The root document: keep `versions`, skip every other field.
struct VersionsField;

impl<'de> Visitor<'de> for VersionsField {
  type Value = Entries<'de>;
  fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
    f.write_str("a packument")
  }
  fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
    let mut entries = Vec::new();
    while let Some(Key(key)) = map.next_key::<Key<'de>>()? {
      if key == "versions" {
        // A repeated root key: the last one wins, as in JSON.parse.
        entries = map.next_value_seed(VersionEntries)?;
      } else {
        map.next_value::<IgnoredAny>()?;
      }
    }
    Ok(entries)
  }
  non_object_is_empty!();
}

/// The `versions` value: its entries in order.
struct VersionEntries;

impl<'de> DeserializeSeed<'de> for VersionEntries {
  type Value = Entries<'de>;
  fn deserialize<D: Deserializer<'de>>(self, deserializer: D) -> Result<Self::Value, D::Error> {
    deserializer.deserialize_any(self)
  }
}

impl<'de> Visitor<'de> for VersionEntries {
  type Value = Entries<'de>;
  fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
    f.write_str("a versions object")
  }
  fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
    let mut entries: Entries<'de> = Vec::with_capacity(map.size_hint().unwrap_or(64));
    while let Some(Key(key)) = map.next_key::<Key<'de>>()? {
      entries.push((key, map.next_value()?));
    }
    Ok(dedupe_keys(entries))
  }
  non_object_is_empty!();
}

/// JSON.parse keeps a duplicate key at its first position with its last value.
/// Registries never send duplicates, so the rebuild only runs when one exists.
fn dedupe_keys(entries: Entries<'_>) -> Entries<'_> {
  let mut seen: HashMap<&str, ()> = HashMap::with_capacity(entries.len());
  if entries
    .iter()
    .all(|(key, _)| seen.insert(key, ()).is_none())
  {
    return entries;
  }
  let mut slot_of: HashMap<&str, usize> = HashMap::with_capacity(entries.len());
  let mut deduped: Entries<'_> = Vec::with_capacity(entries.len());
  for (key, value) in &entries {
    match slot_of.get(key.as_ref()) {
      Some(&slot) => deduped[slot].1 = value,
      None => {
        slot_of.insert(key, deduped.len());
        deduped.push((key.clone(), value));
      }
    }
  }
  deduped
}

#[cfg(test)]
mod tests {
  use super::*;

  fn parse(json: &str) -> Parsed {
    parse_versions(json.as_bytes()).unwrap()
  }

  #[test]
  fn splits_stable_and_prerelease_sorted_descending() {
    let p = parse(
      r#"{"name":"x","dist-tags":{"latest":"1.10.0"},"versions":{
        "1.0.0":{},"2.0.0-beta.1":{},"1.10.0":{},"1.2.0":{},
        "2.0.0-beta.10":{},"2.0.0-alpha":{},"1.0.0+build":{},"not-a-version":{}
      }}"#,
    );
    assert_eq!(p.all_versions, ["1.10.0", "1.2.0", "1.0.0"]);
    assert_eq!(
      p.prerelease_versions,
      ["2.0.0-beta.10", "2.0.0-beta.1", "2.0.0-alpha"]
    );
    assert_eq!(p.latest_version, "1.10.0");
  }

  #[test]
  fn latest_falls_back_to_prerelease_then_unknown() {
    let only_prereleases = parse(r#"{"versions":{"1.0.0-rc.1":{},"1.0.0-rc.2":{}}}"#);
    assert_eq!(only_prereleases.latest_version, "1.0.0-rc.2");

    let empty = [
      r#"{"versions":{}}"#,
      r#"{"name":"x"}"#,
      r#"{"versions":null}"#,
    ];
    let non_objects = [
      r#"{"versions":[1]}"#,
      r#"{"versions":"1.0.0"}"#,
      "[]",
      "3",
      "true",
    ];
    for json in empty.iter().chain(&non_objects) {
      let p = parse(json);
      assert_eq!(p.latest_version, "unknown", "{json}");
      assert!(p.all_versions.is_empty() && p.prerelease_versions.is_empty());
    }
  }

  #[test]
  fn reads_health_signals_of_the_latest_version_only() {
    let p = parse(
      r#"{"versions":{"2.0.0":{"deprecated":true,"engines":{"node":">=18"}},"1.0.0":{"deprecated":"old"}}}"#,
    );
    assert_eq!(p.deprecated.as_deref(), Some("This version is deprecated."));
    assert_eq!(p.engines_node.as_deref(), Some(">=18"));

    let blank = parse(r#"{"versions":{"1.0.0":{"deprecated":"  ﻿","engines":{"node":"\n"}}}}"#);
    assert_eq!((blank.deprecated, blank.engines_node), (None, None));

    let wrong_types = parse(r#"{"versions":{"1.0.0":{"deprecated":false,"engines":["node"]}}}"#);
    assert_eq!(
      (wrong_types.deprecated, wrong_types.engines_node),
      (None, None)
    );

    let escaped = parse(r#"{"versions":{"1.0.0":{"deprecated":"use \"y\" 😀"}}}"#);
    assert_eq!(escaped.deprecated.as_deref(), Some("use \"y\" \u{1F600}"));
  }

  #[test]
  fn duplicate_keys_keep_first_position_and_last_value() {
    let p =
      parse(r#"{"versions":{"1.0.0":{"deprecated":"a"},"0.9.0":{},"1.0.0":{"deprecated":"b"}}}"#);
    assert_eq!(p.all_versions, ["1.0.0", "0.9.0"]);
    assert_eq!(p.deprecated.as_deref(), Some("b"));
  }

  #[test]
  fn escaped_keys_are_unescaped() {
    let p = parse(r#"{"versions":{"1.0.0-alpha":{}}}"#);
    assert_eq!(p.prerelease_versions, ["1.0.0-alpha"]);
  }

  #[test]
  fn rejects_invalid_json() {
    for json in ["", "{", r#"{"versions":{"1.0.0":}}"#, "{} trailing"] {
      assert!(parse_versions(json.as_bytes()).is_err(), "{json}");
    }
  }

  #[test]
  fn js_whitespace_matches_string_trim() {
    assert!(is_js_whitespace('\u{FEFF}'));
    assert!(!is_js_whitespace('\u{85}'));
  }
}
