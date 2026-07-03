import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isCongestionStatus,
  isRetryableStatus,
  isTransientNetworkError,
  parseRetryAfterMs,
  sleep,
} from '../../../../src/shared/http/retry'

describe('isRetryableStatus', () => {
  it('retries timeouts, rate limits, and server errors', () => {
    expect(isRetryableStatus(408)).toBe(true)
    expect(isRetryableStatus(429)).toBe(true)
    expect(isRetryableStatus(500)).toBe(true)
    expect(isRetryableStatus(503)).toBe(true)
    expect(isRetryableStatus(599)).toBe(true)
  })

  it('does not retry client errors or success', () => {
    expect(isRetryableStatus(200)).toBe(false)
    expect(isRetryableStatus(404)).toBe(false)
    expect(isRetryableStatus(499)).toBe(false)
  })
})

describe('isCongestionStatus', () => {
  it('flags only explicit congestion signals', () => {
    expect(isCongestionStatus(429)).toBe(true)
    expect(isCongestionStatus(503)).toBe(true)
    expect(isCongestionStatus(500)).toBe(false)
    expect(isCongestionStatus(408)).toBe(false)
  })
})

describe('parseRetryAfterMs', () => {
  it('returns null when the header is absent or empty', () => {
    expect(parseRetryAfterMs(undefined)).toBeNull()
    expect(parseRetryAfterMs('')).toBeNull()
    expect(parseRetryAfterMs('   ')).toBeNull()
    expect(parseRetryAfterMs([])).toBeNull()
  })

  it('parses delta-seconds into milliseconds', () => {
    expect(parseRetryAfterMs('5')).toBe(5000)
    expect(parseRetryAfterMs('0')).toBe(0)
    expect(parseRetryAfterMs('2.5')).toBe(2500)
  })

  it('rejects negative delta-seconds', () => {
    expect(parseRetryAfterMs('-3')).toBeNull()
  })

  it('uses the first value of an array header', () => {
    expect(parseRetryAfterMs(['7', '9'])).toBe(7000)
  })

  it('parses an HTTP-date relative to now', () => {
    const now = 1_700_000_000_000
    const date = new Date(now + 30_000).toUTCString()

    expect(parseRetryAfterMs(date, now)).toBe(30_000)
  })

  it('clamps HTTP-dates in the past to zero', () => {
    const now = 1_700_000_000_000
    const date = new Date(now - 30_000).toUTCString()

    expect(parseRetryAfterMs(date, now)).toBe(0)
  })

  it('returns null for unparseable values', () => {
    expect(parseRetryAfterMs('soon')).toBeNull()
  })
})

describe('isTransientNetworkError', () => {
  it('rejects non-Error values', () => {
    expect(isTransientNetworkError('ECONNRESET')).toBe(false)
    expect(isTransientNetworkError(null)).toBe(false)
    expect(isTransientNetworkError({ name: 'AbortError' })).toBe(false)
  })

  it('matches transient error names', () => {
    for (const name of [
      'AbortError',
      'HeadersTimeoutError',
      'BodyTimeoutError',
      'ConnectTimeoutError',
      'SocketError',
    ]) {
      const error = new Error('boom')
      error.name = name
      expect(isTransientNetworkError(error)).toBe(true)
    }
  })

  it('matches transient error codes', () => {
    for (const code of [
      'UND_ERR_HEADERS_TIMEOUT',
      'UND_ERR_BODY_TIMEOUT',
      'UND_ERR_CONNECT_TIMEOUT',
      'UND_ERR_SOCKET',
      'ENOTFOUND',
      'EAI_AGAIN',
      'ECONNRESET',
      'ECONNREFUSED',
      'ETIMEDOUT',
      'EPIPE',
    ]) {
      const error = new Error('boom') as Error & { code?: string }
      error.code = code
      expect(isTransientNetworkError(error)).toBe(true)
    }
  })

  it('rejects permanent errors', () => {
    const error = new Error('boom') as Error & { code?: string }
    error.code = 'EACCES'

    expect(isTransientNetworkError(error)).toBe(false)
    expect(isTransientNetworkError(new Error('plain'))).toBe(false)
  })
})

describe('sleep', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves after the given delay', async () => {
    vi.useFakeTimers()
    const resolved = vi.fn()

    const promise = sleep(1000).then(resolved)
    await vi.advanceTimersByTimeAsync(999)
    expect(resolved).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    await promise
    expect(resolved).toHaveBeenCalledOnce()
  })
})
