//! Node-API addon, loaded by src/shared/registry/rust-core.ts.
//!
//! Exports exactly what the loader uses: `abiVersion()` for the compatibility
//! handshake and `decodePackument()` for the work itself.

use std::panic::{catch_unwind, AssertUnwindSafe};

use napi::bindgen_prelude::*;
use napi_derive::napi;

/// `ParsedVersions` as a plain JS object; `None` arrives as null.
#[napi(object)]
pub struct ParsedVersions {
  pub latest_version: String,
  pub all_versions: Vec<String>,
  pub prerelease_versions: Vec<String>,
  pub deprecated: Option<String>,
  pub engines_node: Option<String>,
}

impl From<inup_core::Parsed> for ParsedVersions {
  fn from(p: inup_core::Parsed) -> Self {
    ParsedVersions {
      latest_version: p.latest_version,
      all_versions: p.all_versions,
      prerelease_versions: p.prerelease_versions,
      deprecated: p.deprecated,
      engines_node: p.engines_node,
    }
  }
}

/// Contract version; the loader only uses an addon reporting what it expects.
#[napi]
pub fn abi_version() -> u32 {
  inup_core::ABI_VERSION
}

pub struct DecodeTask {
  raw: Vec<u8>,
  encoding: String,
  cache: Option<CacheTarget>,
}

struct CacheTarget {
  file: String,
  etag: String,
}

impl DecodeTask {
  fn run(&self) -> std::result::Result<inup_core::Parsed, inup_core::Error> {
    let parsed = inup_core::decode_packument(&self.raw, &self.encoding)?;
    if let Some(cache) = &self.cache {
      // Best-effort, like writeEtag: a failed cache write never fails the fetch.
      let _ = std::fs::write(
        &cache.file,
        inup_core::cache_entry_json(&cache.etag, &parsed),
      );
    }
    Ok(parsed)
  }
}

impl Task for DecodeTask {
  type Output = inup_core::Parsed;
  type JsValue = ParsedVersions;

  fn compute(&mut self) -> Result<Self::Output> {
    // `#[napi(catch_unwind)]` only guards synchronous exports; this runs on the
    // libuv pool, so a panic is caught here and becomes a rejected promise that
    // the registry client answers by decoding in TypeScript.
    match catch_unwind(AssertUnwindSafe(|| self.run())) {
      Ok(Ok(parsed)) => Ok(parsed),
      Ok(Err(error)) => Err(Error::from_reason(error.0)),
      Err(_) => Err(Error::from_reason("inup native core panicked")),
    }
  }

  fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
    Ok(output.into())
  }
}

/// Decompress + parse on the libuv thread pool, writing the ETag cache entry
/// there too when `cacheFile` and `etag` are given. Only building the result
/// object touches the JS thread.
#[napi]
pub fn decode_packument(
  raw: &[u8],
  encoding: String,
  cache_file: Option<String>,
  etag: Option<String>,
) -> AsyncTask<DecodeTask> {
  let cache = cache_file
    .zip(etag)
    .map(|(file, etag)| CacheTarget { file, etag });
  AsyncTask::new(DecodeTask {
    raw: raw.to_vec(),
    encoding,
    cache,
  })
}
