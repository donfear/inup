export { PACKAGE_NAME, PACKAGE_VERSION } from './package-meta'
export const NPM_REGISTRY_URL = 'https://registry.npmjs.org'
export const REQUEST_TIMEOUT = 60000 // 60 seconds in milliseconds

// Upper bound for both the HTTP agents' sockets per registry and the adaptive
// concurrency controller's ceiling, kept as one const so they never drift apart.
// Each request holds one socket, so in-flight requests are capped by the agent's
// socket count and the controller must never ramp past it.
export const POOL_CONNECTIONS = 24
