import { Pool, request } from 'undici'
import {
  JSDELIVR_CDN_URL,
  MAX_CONCURRENT_REQUESTS,
  JSDELIVR_POOL_TIMEOUT,
  JSDELIVR_RETRY_TIMEOUTS,
  JSDELIVR_RETRY_DELAYS,
  NPM_REGISTRY_URL,
  REQUEST_TIMEOUT,
} from '../../config'
import { debugLog } from '../../utils'
import { sleep, isRetryableStatus, isTransientNetworkError } from '../http/retry'

const DEFAULT_JSDELIVR_RETRY_TIMEOUT_MS = 2000
const DEFAULT_JSDELIVR_POOL_TIMEOUT_MS = 60000
const MIN_JSDELIVR_CONNECT_TIMEOUT_MS = 500

const toPositiveInteger = (value: number): number | null => {
  if (!Number.isFinite(value) || value <= 0) {
    return null
  }

  const normalized = Math.floor(value)
  return normalized > 0 ? normalized : null
}

export const RETRY_TIMEOUTS = (() => {
  const configured = Array.from(
    new Set(
      JSDELIVR_RETRY_TIMEOUTS.map(toPositiveInteger).filter(
        (value): value is number => value !== null
      )
    )
  ).sort((a, b) => a - b)
  return configured.length > 0 ? configured : [DEFAULT_JSDELIVR_RETRY_TIMEOUT_MS]
})()

const RETRY_DELAYS = JSDELIVR_RETRY_DELAYS.map(toPositiveInteger).filter(
  (value): value is number => value !== null
)

const MAX_RETRY_AFTER_DELAY_MS = RETRY_TIMEOUTS[RETRY_TIMEOUTS.length - 1]
const RETRY_AFTER_HEADER = 'retry-after'

type ResponseHeaders = Record<string, string | string[] | undefined> | undefined

const parseRetryAfterMs = (value: string): number | null => {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  const seconds = Number(trimmed)
  if (Number.isFinite(seconds)) {
    if (seconds <= 0) {
      return null
    }

    const delayMs = Math.floor(seconds * 1000)
    return delayMs > 0 ? delayMs : null
  }

  const dateMs = Date.parse(trimmed)
  if (Number.isNaN(dateMs)) {
    return null
  }

  const delayMs = dateMs - Date.now()
  return delayMs > 0 ? delayMs : null
}

const getHeaderValue = (headers: ResponseHeaders, name: string): string | null => {
  if (!headers) {
    return null
  }

  const direct = headers[name]
  if (typeof direct === 'string') {
    return direct
  }

  if (Array.isArray(direct)) {
    return direct.find((value) => typeof value === 'string') ?? null
  }

  const headerEntry = Object.entries(headers).find(
    ([headerName]) => headerName.toLowerCase() === name
  )
  if (!headerEntry) {
    return null
  }

  const [, rawValue] = headerEntry
  if (typeof rawValue === 'string') {
    return rawValue
  }

  if (Array.isArray(rawValue)) {
    return rawValue.find((value) => typeof value === 'string') ?? null
  }

  return null
}

const getRetryAfterDelay = (headers: ResponseHeaders): number | null => {
  const retryAfterValue = getHeaderValue(headers, RETRY_AFTER_HEADER)
  if (!retryAfterValue) {
    return null
  }

  const parsedDelay = parseRetryAfterMs(retryAfterValue)
  if (parsedDelay === null) {
    return null
  }

  return Math.min(parsedDelay, MAX_RETRY_AFTER_DELAY_MS)
}

const getRetryDelay = (attempt: number, headers?: ResponseHeaders): number => {
  const configuredDelay =
    RETRY_DELAYS.length === 0 ? 0 : RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)]
  const retryAfterDelay = getRetryAfterDelay(headers)
  return retryAfterDelay === null ? configuredDelay : Math.max(configuredDelay, retryAfterDelay)
}

// Keep connection setup bounded by retry budget so fallback stays responsive.
const JSDELIVR_CONNECT_TIMEOUT_MS = Math.max(RETRY_TIMEOUTS[0], MIN_JSDELIVR_CONNECT_TIMEOUT_MS)
const JSDELIVR_POOL_TIMEOUT_MS =
  toPositiveInteger(JSDELIVR_POOL_TIMEOUT) ?? DEFAULT_JSDELIVR_POOL_TIMEOUT_MS
const JSDELIVR_CONNECTIONS = toPositiveInteger(MAX_CONCURRENT_REQUESTS) ?? 1

// Create a persistent connection pool for jsDelivr CDN with optimal settings
// This enables connection reuse and HTTP/1.1 keep-alive for blazing fast requests
export const jsdelivrPool = new Pool('https://cdn.jsdelivr.net', {
  connections: JSDELIVR_CONNECTIONS,
  pipelining: 10,
  keepAliveTimeout: JSDELIVR_POOL_TIMEOUT_MS,
  keepAliveMaxTimeout: JSDELIVR_POOL_TIMEOUT_MS,
  connectTimeout: JSDELIVR_CONNECT_TIMEOUT_MS,
})

const consumeBodySafely = async (body: { text: () => Promise<string> }): Promise<void> => {
  try {
    await body.text()
  } catch {
    // Ignore body read errors on non-200 responses because request will be retried/fallback.
  }
}

export async function fetchPackageManifestFromJsdelivr(
  packageName: string,
  versionTag: string
): Promise<Record<string, unknown> | null> {
  const url = `${JSDELIVR_CDN_URL}/${encodeURIComponent(packageName)}@${versionTag}/package.json`

  for (let attempt = 0; attempt < RETRY_TIMEOUTS.length; attempt++) {
    const timeout = RETRY_TIMEOUTS[attempt]
    const tReq = Date.now()
    try {
      const { statusCode, headers, body } = await request(url, {
        dispatcher: jsdelivrPool,
        method: 'GET',
        headers: {
          accept: 'application/json',
        },
        headersTimeout: timeout,
        bodyTimeout: timeout,
      })

      if (statusCode !== 200) {
        // Consume body to prevent memory leaks
        await consumeBodySafely(body)
        if (isRetryableStatus(statusCode) && attempt < RETRY_TIMEOUTS.length - 1) {
          const delay = getRetryDelay(attempt, headers as ResponseHeaders)
          debugLog.warn(
            'jsdelivr',
            `${packageName}@${versionTag} HTTP ${statusCode}, retry ${attempt + 1} in ${delay}ms`
          )
          if (delay > 0) {
            await sleep(delay)
          }
          continue
        }
        debugLog.warn(
          'jsdelivr',
          `${packageName}@${versionTag} HTTP ${statusCode}, no more retries`
        )
        return null
      }

      const text = await body.text()
      const data = JSON.parse(text) as unknown
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return null
      }

      debugLog.perf('jsdelivr', `fetch manifest ${packageName}@${versionTag}`, tReq)
      return data as Record<string, unknown>
    } catch (error) {
      if (isTransientNetworkError(error) && attempt < RETRY_TIMEOUTS.length - 1) {
        const delay = getRetryDelay(attempt)
        debugLog.warn(
          'jsdelivr',
          `${packageName}@${versionTag} transient error on attempt ${attempt + 1}, retry in ${delay}ms`,
          error
        )
        if (delay > 0) {
          await sleep(delay)
        }
        continue
      }

      if (!isTransientNetworkError(error)) {
        // Unexpected errors are logged for observability.
        console.error(
          `jsDelivr fetch failed for ${packageName}@${versionTag} on attempt ${attempt + 1}/${RETRY_TIMEOUTS.length}`,
          error
        )
        debugLog.error(
          'jsdelivr',
          `unexpected error for ${packageName}@${versionTag} attempt ${attempt + 1}`,
          error
        )
      } else {
        debugLog.warn('jsdelivr', `${packageName}@${versionTag} exhausted retries`, error)
      }
      return null
    }
  }

  return null
}

export async function fetchPackageManifestFromNpmRegistry(
  packageName: string,
  version: string
): Promise<Record<string, unknown> | null> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)

  try {
    const response = await fetch(
      `${NPM_REGISTRY_URL}/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`,
      {
        method: 'GET',
        headers: {
          accept: 'application/json',
        },
        signal: controller.signal,
      }
    )

    if (!response.ok) {
      return null
    }

    return (await response.json()) as Record<string, unknown>
  } catch (error) {
    debugLog.warn(
      'npm-registry',
      `exact manifest fallback failed for ${packageName}@${version}`,
      error
    )
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}
