export { PACKAGE_NAME, PACKAGE_VERSION } from './package-meta'
export const NPM_REGISTRY_URL = 'https://registry.npmjs.org'
// The bulk vulnerability audit answers in well under a second. A registry that has not
// answered by now is not going to, and a headless run waits for it before reporting.
export const AUDIT_TIMEOUT_MS = 10_000

// Upper bound for both the HTTP agents' sockets per registry and the adaptive
// concurrency controller's ceiling, kept as one const so they never drift apart.
// Over HTTP/1.1 each request holds one socket, so in-flight requests are capped
// by the agent's socket count and the controller must never ramp past it while
// any registry in the run answers that way.
export const POOL_CONNECTIONS = 24

// The controller's ceiling once the registry multiplexes requests over one
// HTTP/2 connection, where a request holds a stream instead of a socket. The
// public npm registry allows 100 concurrent streams; a server that allows
// fewer queues the rest on the connection.
export const MULTIPLEXED_STREAMS = 100
