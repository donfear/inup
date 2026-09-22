export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export const isRetryableStatus = (statusCode: number): boolean =>
  statusCode === 408 || statusCode === 429 || statusCode >= 500

// Registry explicitly signaling congestion: the highest-quality back-off signal.
export const isCongestionStatus = (statusCode: number): boolean =>
  statusCode === 429 || statusCode === 503

// Parse a Retry-After header (delta-seconds or HTTP-date) into milliseconds.
// Returns null when absent or unparseable.
export const parseRetryAfterMs = (
  header: string | string[] | undefined,
  now: number = Date.now()
): number | null => {
  if (header === undefined) return null
  const value = (Array.isArray(header) ? header[0] : header)?.toString().trim()
  if (!value) return null
  const asSeconds = Number(value)
  if (Number.isFinite(asSeconds)) {
    return asSeconds >= 0 ? Math.round(asSeconds * 1000) : null
  }
  const asDate = Date.parse(value)
  if (Number.isFinite(asDate)) {
    return Math.max(0, asDate - now)
  }
  return null
}
