/**
 * Self-signed certificate for local TLS test servers: localhost, 127.0.0.1 and
 * ::1, valid until 2126. Test-only; trusted by a test through
 * `tls.setDefaultCACertificates`. Generated with:
 *
 *   openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
 *     -days 36500 -subj "/CN=localhost" \
 *     -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1"
 */

export const LOCALHOST_CERT = `-----BEGIN CERTIFICATE-----
MIIBjDCCATKgAwIBAgIUYWI6oR6so3ALxcGlDxwELHNxXCcwCgYIKoZIzj0EAwIw
FDESMBAGA1UEAwwJbG9jYWxob3N0MCAXDTI2MTAyMDEyNDgyMVoYDzIxMjYwOTI2
MTI0ODIxWjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwWTATBgcqhkjOPQIBBggqhkjO
PQMBBwNCAASBtS2TKjMbyKdC7B11QvdrTx56of7Bd2OTgTi/tD2iMEGlifk9oaLh
c1qyuxEGbnNWma2lKharQz9BtPhMVol2o2AwXjAdBgNVHQ4EFgQU7uePKwTnTfBr
7cLiABQmfa3jTMowDwYDVR0TAQH/BAUwAwEB/zAsBgNVHREEJTAjgglsb2NhbGhv
c3SHBH8AAAGHEAAAAAAAAAAAAAAAAAAAAAEwCgYIKoZIzj0EAwIDSAAwRQIhAPMi
YysHWyzdXJdqv/EguZd3xViwkavEHIyTvveCaSuQAiA6NjprbfFMTC4dGzZiJQ+U
kKQeO/JH8r6zkPlOAzrBPw==
-----END CERTIFICATE-----
`

export const LOCALHOST_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgG8GgOkRn8suM10bm
r9dvySyl5OvRKvRyAbGVPg8VuYqhRANCAASBtS2TKjMbyKdC7B11QvdrTx56of7B
d2OTgTi/tD2iMEGlifk9oaLhc1qyuxEGbnNWma2lKharQz9BtPhMVol2
-----END PRIVATE KEY-----
`
