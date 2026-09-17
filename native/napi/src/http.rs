//! Native registry transport: one conditional GET for a packument, end to end
//! (cache lookup, request, streaming, decode, cache write) off the JS thread.
//!
//! Mirrors `attemptRegistryFetch` in src/shared/registry/npm-registry.ts. The
//! JS side keeps scheduling, retries and the concurrency controller, and falls
//! back to its own node:http transport when an outcome says it should.

use std::collections::HashMap;
use std::panic::AssertUnwindSafe;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use futures_util::FutureExt;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use tokio::sync::oneshot;

/// Kept equal to the JS transport (src/shared/http/http-request.ts, npm-registry.ts).
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const KEEP_ALIVE: Duration = Duration::from_secs(30);
const POOL_CONNECTIONS: usize = 24;
const DEFAULT_HEADERS_TIMEOUT_MS: u32 = 30_000;

/// Response body bytes received across all requests, not yet reported to JS.
static RECEIVED_BYTES: AtomicU64 = AtomicU64::new(0);

/// In-flight requests by JS-assigned id. `Pending` is a cancel handle; `Cancelled`
/// records a cancel that arrived before the request started running (the async
/// body starts on a runtime thread, after the JS call has already returned).
enum Slot {
  Pending(oneshot::Sender<()>),
  Cancelled,
}

static IN_FLIGHT: OnceLock<Mutex<HashMap<u32, Slot>>> = OnceLock::new();

fn in_flight() -> std::sync::MutexGuard<'static, HashMap<u32, Slot>> {
  let map = IN_FLIGHT.get_or_init(Default::default);
  map.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[napi(object)]
pub struct FetchRequest {
  /// Absolute packument URL.
  pub url: String,
  pub authorization: Option<String>,
  /// ETag cache entry to revalidate against and to write on a 200; null = no cache.
  pub cache_file: Option<String>,
  /// Id for `cancelFetch`.
  pub request_id: Option<u32>,
  /// Overrides the 30 s headers timeout (tests).
  pub headers_timeout_ms: Option<u32>,
}

#[napi(object)]
pub struct FetchOutcome {
  /// success | not-found | retryable | congested | transient | cancelled | fallback
  pub kind: String,
  /// Version data as JSON text (`ParsedVersions`); JSON.parse beats building
  /// hundreds of strings through napi one by one.
  pub data_json: Option<String>,
  pub revalidated: bool,
  /// Compressed body bytes of a 200 (0 for a 304 or an error).
  pub bytes: f64,
  pub latency_ms: f64,
  pub status: u32,
  /// Raw Retry-After header of a congestion response.
  pub retry_after: Option<String>,
  /// For transient / fallback: tls | connect | timeout | io | decode | internal
  pub error_class: Option<String>,
  pub error: Option<String>,
}

impl FetchOutcome {
  fn kind(kind: &str, started: Instant) -> Self {
    FetchOutcome {
      kind: kind.to_owned(),
      data_json: None,
      revalidated: false,
      bytes: 0.0,
      latency_ms: started.elapsed().as_secs_f64() * 1000.0,
      status: 0,
      retry_after: None,
      error_class: None,
      error: None,
    }
  }

  fn failed(kind: &str, class: &str, error: impl ToString, started: Instant) -> Self {
    FetchOutcome {
      error_class: Some(class.to_owned()),
      error: Some(error.to_string()),
      ..Self::kind(kind, started)
    }
  }
}

fn client() -> std::result::Result<&'static reqwest::Client, String> {
  static CLIENT: OnceLock<std::result::Result<reqwest::Client, String>> = OnceLock::new();
  CLIENT
    .get_or_init(|| {
      let _ = rustls::crypto::ring::default_provider().install_default();
      let mut builder = reqwest::Client::builder()
        .http1_only()
        // The JS transport ignores proxy env vars; stay identical.
        .no_proxy()
        .connect_timeout(CONNECT_TIMEOUT)
        .pool_idle_timeout(KEEP_ALIVE)
        .pool_max_idle_per_host(POOL_CONNECTIONS)
        .tls_backend_rustls();
      // The OS trust store is used by default; honor Node's extra CA bundle too.
      if let Ok(path) = std::env::var("NODE_EXTRA_CA_CERTS") {
        if let Ok(pem) = std::fs::read(&path) {
          for cert in reqwest::Certificate::from_pem_bundle(&pem).unwrap_or_default() {
            builder = builder.add_root_certificate(cert);
          }
        }
      }
      builder.build().map_err(|e| e.to_string())
    })
    .as_ref()
    .map_err(Clone::clone)
}

/// Whether a TLS failure is anywhere in the error chain. rustls errors reach
/// us wrapped in `std::io::Error`, whose `source()` skips the wrapped error
/// itself, so io errors are unwrapped explicitly.
fn is_tls_error(error: &(dyn std::error::Error + 'static)) -> bool {
  let mut current = Some(error);
  while let Some(err) = current {
    if err.is::<rustls::Error>() {
      return true;
    }
    if let Some(inner) = err
      .downcast_ref::<std::io::Error>()
      .and_then(|io| io.get_ref())
    {
      if is_tls_error(inner) {
        return true;
      }
    }
    current = err.source();
  }
  false
}

/// Classify a reqwest error; TLS problems are what the JS side retries with Node's own stack.
fn error_class(error: &reqwest::Error) -> &'static str {
  if is_tls_error(error) {
    "tls"
  } else if error.is_timeout() {
    "timeout"
  } else if error.is_connect() {
    "connect"
  } else {
    "io"
  }
}

/// Start tracking a request; the receiver fires when it is cancelled.
fn register(id: Option<u32>) -> Option<oneshot::Receiver<()>> {
  let id = id?;
  let (tx, rx) = oneshot::channel();
  let mut map = in_flight();
  match map.remove(&id) {
    Some(Slot::Cancelled) => {
      let _ = tx.send(());
    }
    _ => {
      map.insert(id, Slot::Pending(tx));
    }
  }
  Some(rx)
}

fn unregister(id: Option<u32>) {
  if let Some(id) = id {
    in_flight().remove(&id);
  }
}

async fn run(request: FetchRequest, started: Instant) -> FetchOutcome {
  let client = match client() {
    Ok(client) => client,
    Err(error) => return FetchOutcome::failed("fallback", "internal", error, started),
  };

  let cached = match request.cache_file.clone() {
    Some(file) => tokio::task::spawn_blocking(move || inup_core::read_cache_entry(&file))
      .await
      .ok()
      .flatten(),
    None => None,
  };

  let mut http = client
    .get(&request.url)
    .header("accept", "application/vnd.npm.install-v1+json")
    .header("accept-encoding", "gzip, deflate, br");
  if let Some(auth) = &request.authorization {
    http = http.header("authorization", auth);
  }
  if let Some(entry) = &cached {
    http = http.header("if-none-match", &entry.etag);
  }

  let headers_timeout = Duration::from_millis(
    request
      .headers_timeout_ms
      .unwrap_or(DEFAULT_HEADERS_TIMEOUT_MS)
      .into(),
  );
  let mut response = match tokio::time::timeout(headers_timeout, http.send()).await {
    Err(_) => return FetchOutcome::failed("transient", "timeout", "headers timeout", started),
    Ok(Err(error)) => {
      let class = error_class(&error);
      let kind = if class == "tls" {
        "fallback"
      } else {
        "transient"
      };
      return FetchOutcome::failed(kind, class, error, started);
    }
    Ok(Ok(response)) => response,
  };

  let status = response.status().as_u16();
  if status == 304 {
    if let Some(entry) = cached {
      return FetchOutcome {
        kind: "success".into(),
        data_json: Some(entry.data.get().to_owned()),
        revalidated: true,
        status: 304,
        ..FetchOutcome::kind("success", started)
      };
    }
  }
  if !(200..300).contains(&status) {
    let kind = match status {
      429 | 503 => "congested",
      408 | 500..=u16::MAX => "retryable",
      _ => "not-found",
    };
    let retry_after = response
      .headers()
      .get("retry-after")
      .and_then(|v| v.to_str().ok())
      .map(str::to_owned);
    return FetchOutcome {
      status: status.into(),
      retry_after,
      ..FetchOutcome::kind(kind, started)
    };
  }

  let header = |name: &str| {
    response
      .headers()
      .get(name)
      .and_then(|v| v.to_str().ok())
      .map(str::to_owned)
  };
  let encoding = header("content-encoding")
    .unwrap_or_default()
    .to_ascii_lowercase();
  let etag = header("etag").filter(|e| !e.is_empty());

  let mut body = Vec::with_capacity(response.content_length().unwrap_or(0) as usize);
  loop {
    match response.chunk().await {
      Ok(Some(chunk)) => {
        RECEIVED_BYTES.fetch_add(chunk.len() as u64, Ordering::Relaxed);
        body.extend_from_slice(&chunk);
      }
      Ok(None) => break,
      Err(error) => return FetchOutcome::failed("transient", error_class(&error), error, started),
    }
  }
  let bytes = body.len() as f64;

  let cache_file = request.cache_file;
  let decoded = tokio::task::spawn_blocking(move || {
    let parsed = inup_core::decode_packument(&body, &encoding)?;
    if let (Some(file), Some(etag)) = (cache_file, etag) {
      // Best-effort, like writeEtag.
      let _ = std::fs::write(file, inup_core::cache_entry_json(&etag, &parsed));
    }
    Ok::<_, inup_core::Error>(inup_core::parsed_json(&parsed))
  })
  .await;

  match decoded {
    Ok(Ok(json)) => FetchOutcome {
      data_json: Some(json),
      bytes,
      status: status.into(),
      ..FetchOutcome::kind("success", started)
    },
    Ok(Err(error)) => FetchOutcome::failed("transient", "decode", error, started),
    Err(error) => FetchOutcome::failed("fallback", "internal", error, started),
  }
}

/// One registry attempt. Never rejects: every failure is an outcome kind, and
/// a panic becomes `fallback` so the JS transport redoes the attempt.
#[napi]
pub async fn fetch_packument(request: FetchRequest) -> Result<FetchOutcome> {
  let started = Instant::now();
  let id = request.request_id;
  let cancelled = register(id);
  let work = AssertUnwindSafe(run(request, started)).catch_unwind();
  let outcome = match cancelled {
    Some(cancelled) => tokio::select! {
      result = work => result,
      _ = cancelled => Ok(FetchOutcome::kind("cancelled", started)),
    },
    None => work.await,
  };
  unregister(id);
  Ok(outcome.unwrap_or_else(|_| FetchOutcome::failed("fallback", "internal", "panic", started)))
}

/// Abort an in-flight `fetchPackument`; it resolves with kind `cancelled`.
/// Call it only for requests whose promise has not settled yet.
#[napi]
pub fn cancel_fetch(request_id: u32) {
  let mut map = in_flight();
  match map.remove(&request_id) {
    Some(Slot::Pending(tx)) => {
      let _ = tx.send(());
    }
    _ => {
      map.insert(request_id, Slot::Cancelled);
    }
  }
}

/// Body bytes received since the last call (feeds the concurrency controller).
#[napi]
pub fn take_received_bytes() -> f64 {
  RECEIVED_BYTES.swap(0, Ordering::Relaxed) as f64
}
