export { PACKAGE_NAME, PACKAGE_VERSION } from './package-meta'
export const NPM_REGISTRY_URL = 'https://registry.npmjs.org'
export const REQUEST_TIMEOUT = 60000 // 60 seconds in milliseconds

// Upper bound for both the undici Pool's connection count and the adaptive
// concurrency controller's ceiling, kept as one const so they never drift apart.
// With pipelining:1, effective in-flight requests are capped by the pool's
// connection count, so the controller must never ramp past it.
export const POOL_CONNECTIONS = 24
