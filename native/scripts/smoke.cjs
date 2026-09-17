#!/usr/bin/env node
// Prove one built addon loads and works on this machine, with no dependencies,
// so it runs on bare Node: Alpine containers, Rosetta, arm runners.
//
//   node native/scripts/smoke.cjs native/out/inup.<abi>.node
//
// Checks: the ABI handshake; decodePackument in every encoding with its cache
// write; fetchPackument through the Rust HTTP stack against a local server;
// and that a failed TLS handshake is reported as a fallback.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const zlib = require('node:zlib')

const EXPECTED_ABI = 1

const file = process.argv[2]
if (!file) {
  console.error('usage: smoke.cjs <path/to/inup.<abi>.node>')
  process.exit(2)
}

const packument = {
  name: 'smoke',
  versions: {
    '1.0.0': {},
    '1.10.0': { deprecated: 'use 2.x', engines: { node: '>=18' } },
    '1.2.0': {},
    '2.0.0-rc.1': {},
    '2.0.0-beta.2': {},
  },
}
const expected = {
  latestVersion: '1.10.0',
  allVersions: ['1.10.0', '1.2.0', '1.0.0'],
  prereleaseVersions: ['2.0.0-rc.1', '2.0.0-beta.2'],
  deprecated: 'use 2.x',
  enginesNode: '>=18',
}

function listen(handler) {
  const server = http.createServer(handler)
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

async function main() {
  const addon = require(path.resolve(file))
  assert.equal(addon.abiVersion(), EXPECTED_ABI, 'abiVersion')

  const body = Buffer.from(JSON.stringify(packument))
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inup-smoke-'))
  const bodies = {
    identity: ['', body],
    gzip: ['gzip', zlib.gzipSync(body)],
    deflate: ['deflate', zlib.deflateSync(body)],
    br: ['br', zlib.brotliCompressSync(body)],
  }

  for (const [label, [encoding, raw]] of Object.entries(bodies)) {
    const cacheFile = path.join(tmp, `${label}.json`)
    const result = await addon.decodePackument(raw, encoding, cacheFile, 'W/"smoke"')
    assert.deepEqual({ ...result }, expected, `decode ${label}`)
    assert.equal(
      fs.readFileSync(cacheFile, 'utf8'),
      JSON.stringify({ etag: 'W/"smoke"', data: expected }),
      `cache entry ${label}`
    )
  }
  await assert.rejects(addon.decodePackument(Buffer.from('{"versions":'), '', null, null))

  const server = await listen((_req, res) => {
    res.writeHead(200, { 'content-encoding': 'br', etag: 'W/"net"' })
    res.end(zlib.brotliCompressSync(body))
  })
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const cacheFile = path.join(tmp, 'net.json')
    const fetched = await addon.fetchPackument({ url: `${base}/smoke`, cacheFile })
    assert.equal(fetched.kind, 'success', `fetch: ${fetched.error ?? ''}`)
    assert.deepEqual(JSON.parse(fetched.dataJson), expected, 'fetch data')
    assert.ok(fs.existsSync(cacheFile), 'fetch cache entry')
    assert.ok(addon.takeReceivedBytes() > 0, 'byte counter')

    // TLS against a plain HTTP server must ask for the JS fallback.
    const tls = await addon.fetchPackument({ url: base.replace('http:', 'https:') })
    assert.equal(tls.kind, 'fallback', `tls classification: ${tls.kind} ${tls.errorClass}`)
    assert.equal(tls.errorClass, 'tls')
  } finally {
    server.close()
  }

  fs.rmSync(tmp, { recursive: true, force: true })
  console.log(`ok: ${path.basename(file)} on ${process.platform}-${process.arch}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
