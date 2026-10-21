//! Rust port of inup's registry hot path: decompress a packument response,
//! reduce it to what `parseVersions` (src/shared/versions.ts) returns, and
//! serialize the ETag cache entry `writeEtag` would write, with the freshness
//! `responseFreshness` (src/shared/http/etag-store.ts) derives from its headers.
//!
//! Output must stay identical to the TypeScript implementation; the napi
//! crate is a thin Node-API wrapper around these functions.

mod packument;
mod semver;

use std::borrow::Cow;
use std::fmt;
use std::io::Read;

use serde::{Deserialize, Serialize};

pub use packument::parse_versions;

/// Version of the JS <-> Rust contract. Bump together with CORE_ABI_VERSION in
/// src/shared/registry/rust-core.ts whenever a binding's signature or result
/// shape changes: the loader ignores an addon reporting anything else.
pub const ABI_VERSION: u32 = 1;

/// Mirrors `ParsedVersions` in src/shared/versions.ts. `None` fields are left
/// out when serialized, like undefined properties under JSON.stringify.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Parsed {
  pub latest_version: String,
  pub all_versions: Vec<String>,
  pub prerelease_versions: Vec<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub deprecated: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub engines_node: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Error(pub String);

impl fmt::Display for Error {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    f.write_str(&self.0)
  }
}

impl std::error::Error for Error {}

/// Decode a body by its `content-encoding`, like attemptRegistryFetch:
/// gzip, br and deflate are decompressed, anything else passes through.
pub fn decompress<'a>(raw: &'a [u8], encoding: &str) -> Result<Cow<'a, [u8]>, Error> {
  // Packuments compress roughly 8-10x; start close to avoid regrowth.
  let mut out = Vec::with_capacity(raw.len().saturating_mul(8));
  let result = match encoding {
    "br" => brotlic::DecompressorReader::new(raw).read_to_end(&mut out),
    "gzip" => flate2::read::MultiGzDecoder::new(raw).read_to_end(&mut out),
    "deflate" => flate2::read::ZlibDecoder::new(raw).read_to_end(&mut out),
    _ => return Ok(Cow::Borrowed(raw)),
  };
  result.map_err(|e| Error(format!("failed to decompress {encoding} body: {e}")))?;
  Ok(Cow::Owned(out))
}

/// A stored ETag cache entry, as writeEtag / cache_entry_json write it. `data`
/// stays raw JSON: it is handed back to JS as-is on a 304. Freshness fields are
/// only read by JS, so they are left out here.
#[derive(Debug, Deserialize)]
pub struct CacheEntry {
  pub etag: String,
  pub data: Box<serde_json::value::RawValue>,
}

/// Read a cache entry the way readEtag does: anything unreadable, malformed or
/// missing its etag / object data is simply "no entry".
pub fn read_cache_entry(file: &str) -> Option<CacheEntry> {
  let bytes = std::fs::read(file).ok()?;
  let entry = serde_json::from_slice::<CacheEntry>(&bytes).ok()?;
  entry.data.get().starts_with('{').then_some(entry)
}

/// `JSON.stringify(parsed)`: the version data as JSON text for JS to parse.
pub fn parsed_json(parsed: &Parsed) -> String {
  serde_json::to_string(parsed).expect("a struct of strings always serializes to JSON")
}

/// Decompress + parse in one call.
pub fn decode_packument(raw: &[u8], encoding: &str) -> Result<Parsed, Error> {
  parse_versions(&decompress(raw, encoding)?)
}

/// How long a response may be reused without asking the registry again;
/// mirrors `Freshness` in src/shared/http/etag-store.ts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Freshness {
  /// When the request was sent, in ms since the Unix epoch.
  pub fetched_at: u64,
  /// Seconds after `fetched_at` the response stays fresh: max-age minus Age.
  pub ttl: u64,
}

/// Upper bound on max-age, whatever a registry sends (MAX_TTL_SECONDS in etag-store.ts).
pub const MAX_TTL_SECONDS: u64 = 300;

/// A delta-seconds value: one or more ASCII digits. Saturates where JS numbers
/// would merely lose precision, which ends up in the same freshness either way.
fn parse_seconds(value: &str) -> Option<u64> {
  if value.is_empty() || !value.bytes().all(|b| b.is_ascii_digit()) {
    return None;
  }
  Some(value.bytes().fold(0u64, |n, b| {
    n.saturating_mul(10).saturating_add(u64::from(b - b'0'))
  }))
}

/// `responseFreshness`: the freshness a response grants from its (joined)
/// Cache-Control and Age headers, or None when it must always be revalidated.
pub fn response_freshness(
  cache_control: Option<&str>,
  age: Option<&str>,
  fetched_at: u64,
) -> Option<Freshness> {
  let mut max_age: Option<u64> = None;
  for directive in cache_control.unwrap_or_default().split(',') {
    let (name, value) = match directive.split_once('=') {
      Some((name, value)) => (name.trim(), Some(value.trim())),
      None => (directive.trim(), None),
    };
    let name = name.to_lowercase();
    if name == "no-cache" || name == "no-store" || name == "private" {
      return None;
    }
    if name == "max-age" {
      let seconds = parse_seconds(value?)?;
      max_age = Some(max_age.map_or(seconds, |current| current.min(seconds)));
    }
  }
  let age = match age {
    Some(value) => parse_seconds(value.trim())?,
    None => 0,
  };
  let ttl = max_age?.min(MAX_TTL_SECONDS).checked_sub(age)?;
  (ttl > 0).then_some(Freshness { fetched_at, ttl })
}

/// `JSON.stringify` of an entry, freshness fields last and only when present.
fn entry_json<D: Serialize + ?Sized>(etag: &str, data: &D, freshness: Option<Freshness>) -> String {
  #[derive(Serialize)]
  #[serde(rename_all = "camelCase")]
  struct Entry<'a, D: ?Sized> {
    etag: &'a str,
    data: &'a D,
    #[serde(skip_serializing_if = "Option::is_none")]
    fetched_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ttl: Option<u64>,
  }
  serde_json::to_string(&Entry {
    etag,
    data,
    fetched_at: freshness.map(|f| f.fetched_at),
    ttl: freshness.map(|f| f.ttl),
  })
  .expect("a struct of strings and numbers always serializes to JSON")
}

/// The ETag cache entry writeEtag stores: `JSON.stringify({ etag, data })`,
/// plus `fetchedAt` and `ttl` when the response granted freshness. serde_json
/// escapes exactly the characters JSON.stringify does for valid Unicode
/// strings, so the bytes match.
pub fn cache_entry_json(etag: &str, data: &Parsed, freshness: Option<Freshness>) -> String {
  entry_json(etag, data, freshness)
}

/// A stored entry with renewed freshness after a 304, as renewEtag writes it.
/// The data is copied as raw JSON text, unchanged.
pub fn renewed_cache_entry_json(entry: &CacheEntry, freshness: Freshness) -> String {
  entry_json(&entry.etag, &*entry.data, Some(freshness))
}

#[cfg(test)]
mod tests {
  use std::io::Write;

  use super::*;

  const BODY: &[u8] = br#"{"versions":{"1.0.0":{},"2.0.0":{"engines":{"node":">=20"}}}}"#;

  fn expected() -> Parsed {
    Parsed {
      latest_version: "2.0.0".into(),
      all_versions: vec!["2.0.0".into(), "1.0.0".into()],
      prerelease_versions: vec![],
      deprecated: None,
      engines_node: Some(">=20".into()),
    }
  }

  #[test]
  fn abi_version_is_pinned() {
    // src/shared/registry/rust-core.ts refuses any addon reporting another value.
    assert_eq!(ABI_VERSION, 1);
  }

  #[test]
  fn decodes_every_supported_encoding() {
    let mut gzip = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    gzip.write_all(BODY).unwrap();
    let mut zlib = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
    zlib.write_all(BODY).unwrap();
    let mut br = Vec::new();
    brotli::BrotliCompress(&mut &BODY[..], &mut br, &Default::default()).unwrap();

    assert_eq!(decode_packument(BODY, "").unwrap(), expected());
    assert_eq!(decode_packument(BODY, "identity").unwrap(), expected());
    assert_eq!(
      decode_packument(&gzip.finish().unwrap(), "gzip").unwrap(),
      expected()
    );
    assert_eq!(
      decode_packument(&zlib.finish().unwrap(), "deflate").unwrap(),
      expected()
    );
    assert_eq!(decode_packument(&br, "br").unwrap(), expected());
  }

  #[test]
  fn rejects_corrupt_compressed_bodies() {
    for encoding in ["gzip", "deflate", "br"] {
      let err = decode_packument(b"definitely not compressed", encoding).unwrap_err();
      assert!(err.0.contains(encoding), "{err}");
    }
  }

  #[test]
  fn cache_entry_matches_json_stringify() {
    let mut data = expected();
    data.deprecated = Some("use \"b\"\n\u{1}\u{2028}/\u{7f}\u{e9}".into());
    // Node: JSON.stringify({ etag: 'W/"1"', data }) — control chars become
    // \u00XX, U+2028 / DEL / non-ASCII / slash stay literal.
    let want = [
      r#"{"etag":"W/\"1\"","data":{"latestVersion":"2.0.0","allVersions":["2.0.0","1.0.0"],"#,
      r#""prereleaseVersions":[],"deprecated":"use \"b\"\n"#,
      "\\u0001\u{2028}/\u{7f}\u{e9}",
      r#"","enginesNode":">=20"}}"#,
    ]
    .concat();
    assert_eq!(cache_entry_json("W/\"1\"", &data, None), want);
  }

  #[test]
  fn cache_entry_appends_freshness_like_write_etag() {
    let fresh = Freshness {
      fetched_at: 1_760_000_000_123,
      ttl: 169,
    };
    let want = [
      r#"{"etag":"e","data":{"latestVersion":"2.0.0","allVersions":["2.0.0","1.0.0"],"#,
      r#""prereleaseVersions":[],"enginesNode":">=20"},"fetchedAt":1760000000123,"ttl":169}"#,
    ]
    .concat();
    assert_eq!(cache_entry_json("e", &expected(), Some(fresh)), want);
  }

  #[test]
  fn renewed_entry_keeps_the_raw_data_and_replaces_freshness() {
    let dir = std::env::temp_dir().join(format!("inup-core-renew-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("entry.json");
    let data = r#"{"latestVersion":"1.0.0","allVersions":["1.0.0"],"x":"\u0001"}"#;
    std::fs::write(
      &file,
      format!(r#"{{"etag":"W/\"1\"","data":{data},"fetchedAt":1,"ttl":300}}"#),
    )
    .unwrap();
    let entry = read_cache_entry(file.to_str().unwrap()).unwrap();
    let fresh = Freshness {
      fetched_at: 42,
      ttl: 7,
    };
    assert_eq!(
      renewed_cache_entry_json(&entry, fresh),
      format!(r#"{{"etag":"W/\"1\"","data":{data},"fetchedAt":42,"ttl":7}}"#)
    );
    std::fs::remove_dir_all(&dir).unwrap();
  }

  #[test]
  fn freshness_follows_max_age_minus_age() {
    let at = 1000;
    let fresh = |ttl| {
      Some(Freshness {
        fetched_at: at,
        ttl,
      })
    };
    let cases: &[(Option<&str>, Option<&str>, Option<Freshness>)] = &[
      (Some("public, max-age=300"), Some("131"), fresh(169)),
      (Some("public, max-age=300"), None, fresh(300)),
      (Some("max-age=60"), Some(" 0 "), fresh(60)),
      (Some("PUBLIC, MAX-AGE = 120"), None, fresh(120)),
      (Some("max-age=86400"), Some("100"), fresh(200)),
      (Some("max-age=99999999999999999999999"), None, fresh(300)),
      (Some("max-age=300, max-age=30"), None, fresh(30)),
      (Some("max-age=300,max-age=30"), Some("10"), fresh(20)),
      (Some("public, max-age=300"), Some("300"), None),
      (Some("public, max-age=300"), Some("301"), None),
      (
        Some("public, max-age=300"),
        Some("99999999999999999999999"),
        None,
      ),
      (Some("public, max-age=300"), Some("-1"), None),
      (Some("public, max-age=300"), Some(""), None),
      (Some("public, max-age=300"), Some("1.5"), None),
      (Some("max-age=0"), None, None),
      (Some("max-age=\"300\""), None, None),
      (Some("max-age=30x"), None, None),
      (Some("max-age"), None, None),
      (Some("max-age="), None, None),
      (Some("max-age=30=0"), None, None),
      (Some("public"), None, None),
      (Some(""), None, None),
      (None, None, None),
      (Some("no-cache, max-age=300"), None, None),
      (Some("max-age=300, no-store"), None, None),
      (Some("private, max-age=300"), None, None),
      (Some("max-age=300, private=\"set-cookie\""), None, None),
      (Some("max-age=300, No-Cache"), None, None),
      (Some("s-maxage=300"), None, None),
      (
        Some("public, s-maxage=600, max-age=300, must-revalidate"),
        Some("5"),
        fresh(295),
      ),
    ];
    for (cache_control, age, want) in cases {
      assert_eq!(
        response_freshness(*cache_control, *age, at),
        *want,
        "cache-control {cache_control:?}, age {age:?}"
      );
    }
  }
}
