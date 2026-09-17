//! Rust port of inup's registry hot path: decompress a packument response,
//! reduce it to what `parseVersions` (src/shared/versions.ts) returns, and
//! serialize the ETag cache entry `writeEtag` would write.
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
/// stays raw JSON: it is handed back to JS as-is on a 304.
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

/// `JSON.stringify({ etag, data })`: the ETag cache entry writeEtag stores.
/// serde_json escapes exactly the characters JSON.stringify does for valid
/// Unicode strings, so the bytes match.
pub fn cache_entry_json(etag: &str, data: &Parsed) -> String {
  #[derive(Serialize)]
  struct Entry<'a> {
    etag: &'a str,
    data: &'a Parsed,
  }
  serde_json::to_string(&Entry { etag, data })
    .expect("a struct of strings always serializes to JSON")
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
    assert_eq!(cache_entry_json("W/\"1\"", &data), want);
  }
}
