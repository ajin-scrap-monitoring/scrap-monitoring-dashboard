import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createConnection } from 'node:net'
import { request as httpRequest } from 'node:http'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const image = process.argv[2]
if (!image) {
  throw new Error('Usage: node test/proxy/integration.mjs <frontend-image>')
}

const testDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(testDirectory, '../..')
const suffix = process.env.VERIFY_RUN_ID ?? `${process.pid}-${Date.now()}`
assert.match(suffix, /^[a-z0-9-]+$/)
const network = `proxy-integration-${suffix}`
const upstreamName = `proxy-integration-upstream-${suffix}`
const frontendName = `proxy-integration-frontend-${suffix}`
const upstreamImage = `scrap-monitoring-dashboard-proxy-upstream:${suffix}`
const hostPort = 18100 + (process.pid % 500)

function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    ...options,
  })
  if (result.status !== 0) {
    throw new Error(`${command} ${arguments_.join(' ')} failed.\n${result.stdout}\n${result.stderr}`)
  }
  return result.stdout.trim()
}

function runQuietly(command, arguments_) {
  spawnSync(command, arguments_, { cwd: repositoryRoot, stdio: 'ignore' })
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}

async function waitForHealthy(containerName) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const health = run('docker', ['inspect', '--format', '{{.State.Health.Status}}', containerName])
    if (health === 'healthy') {
      return
    }
    await sleep(250)
  }
  throw new Error(`Container ${containerName} did not become healthy.`)
}

async function request(path, options) {
  return fetch(`http://127.0.0.1:${hostPort}${path}`, options)
}

function rawRequest(path, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const client = httpRequest({ host: '127.0.0.1', port: hostPort, path, ...options }, (response) => {
      response.resume()
      response.on('end', () => resolvePromise(response.statusCode))
    })
    client.on('error', reject)
    client.end()
  })
}

async function verifyDailyGateway(metricsPath, mediaHost, authHost) {
  const recordingId = '550e8400-e29b-41d4-a716-446655440000'
  const segmentId = '550e8400-e29b-41d4-a716-446655440001'
  const base = `/media/daily-recordings/${recordingId}`
  const playlistPath = `${base}/hls/index.m3u8`
  const segmentPath = `${base}/media/${segmentId}.ts`
  const contentPath = `${base}/content`
  const metrics = async () => (await request(metricsPath)).json()
  const credentials = {
    cookie: 'scrap_session=proxy-viewer',
    authorization: 'Bearer synthetic-authorization',
    'proxy-authorization': 'Basic synthetic-proxy-authorization',
    'x-api-key': 'synthetic-api-key',
    'x-auth-token': 'synthetic-auth-token',
    'x-csrf-token': 'synthetic-csrf-token',
    'x-original-uri': '/media/private?token=synthetic-original-token',
    origin: 'https://dashboard.example.invalid',
    referer: 'https://dashboard.example.invalid/?token=synthetic-referer-token',
    range: 'bytes=100-199',
    'if-range': '"proxy-media-etag"',
  }
  function mediaHeaders(response) {
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(response.headers.get('x-accel-buffering'), 'no')
    assert.equal(response.headers.get('set-cookie'), null)
    assert.equal(response.headers.get('x-powered-by'), null)
    assert.equal(response.headers.get('content-location'), null)
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(response.headers.get('x-frame-options'), 'DENY')
    assert.match(response.headers.get('x-request-id') ?? '', /.+/)
  }
  async function upstreamRequest(path, method = 'GET') {
    const observed = await metrics()
    assert.deepEqual(observed.lastDailyRequest, {
      url: path,
      method,
      headers: { host: mediaHost, range: credentials.range, 'if-range': credentials['if-range'] },
    })
    assert.deepEqual(observed.lastAuthRequest, {
      url: '/api/v1/media/access',
      headers: { host: authHost, cookie: credentials.cookie },
    })
  }

  const before = await metrics()
  const playlist = await request(`${playlistPath}?download=true&token=must-not-leak`, { headers: credentials })
  assert.equal(playlist.status, 200)
  mediaHeaders(playlist)
  assert.match(playlist.headers.get('content-type'), /^application\/vnd\.apple\.mpegurl/)
  const manifest = await playlist.text()
  assert.match(manifest, /^#EXTM3U\n/)
  assert.doesNotMatch(manifest, /\/api\/v2\/|must-not-leak|https?:\/\//)
  const segments = manifest.split('\n').filter((line) => line && !line.startsWith('#'))
  assert.deepEqual(segments, [segmentPath, `${base}/media/segment-02.ts`])
  assert.match(manifest, /#EXT-X-DISCONTINUITY/)
  await upstreamRequest(`/api/v2/daily-recordings/${recordingId}/hls/index.m3u8`)

  const head = await request(playlistPath, { headers: credentials, method: 'HEAD' })
  assert.equal(head.status, 200)
  assert.equal((await head.arrayBuffer()).byteLength, 0)
  mediaHeaders(head)
  await upstreamRequest(`/api/v2/daily-recordings/${recordingId}/hls/index.m3u8`, 'HEAD')

  let requestsSent = 2
  for (const [path, expectedPath] of [
    [`${segmentPath}?download=true&token=must-not-leak`, `/api/v2/daily-recordings/${recordingId}/media/${segmentId}.ts`],
    [`${base}/media/segment-02.ts`, `/api/v2/daily-recordings/${recordingId}/media/segment-02.ts`],
    [`${contentPath}?download=true&token=must-not-leak`, `/api/v2/daily-recordings/${recordingId}/content?download=true`],
    [`${contentPath}?download=false&token=must-not-leak`, `/api/v2/daily-recordings/${recordingId}/content`],
    [`${contentPath}?token=must-not-leak`, `/api/v2/daily-recordings/${recordingId}/content`],
  ]) {
    for (const method of ['GET', 'HEAD']) {
      const response = await request(path, { method, headers: credentials })
      requestsSent += 1
      assert.equal(response.status, 206)
      mediaHeaders(response)
      assert.equal(response.headers.get('content-range'), 'bytes 100-199/1024')
      assert.equal(response.headers.get('content-length'), '100')
      assert.equal(response.headers.get('accept-ranges'), 'bytes')
      assert.equal(response.headers.get('etag'), credentials['if-range'])
      assert.equal(response.headers.get('last-modified'), 'Wed, 14 Oct 2026 12:00:00 GMT')
      assert.match(response.headers.get('content-type'), path.includes('/media/') && path.includes('.ts') ? /^video\/mp2t/ : /^video\/mp4/)
      assert.match(response.headers.get('content-disposition'), expectedPath.endsWith('?download=true') ? /^attachment;/ : /^inline;/)
      const bytes = Buffer.from(await response.arrayBuffer())
      assert.equal(bytes.byteLength, method === 'HEAD' ? 0 : 100)
      if (method === 'GET') assert.deepEqual(bytes, Buffer.from(Array.from({ length: 100 }, (_, index) => (index + 100) % 251)))
      await upstreamRequest(expectedPath, method)
    }
  }
  const afterValid = await metrics()
  assert.equal(afterValid.mediaRequests, before.mediaRequests + requestsSent)
  assert.equal(afterValid.authRequests, before.authRequests + requestsSent)

  const changed = await request(contentPath, { headers: { ...credentials, 'if-range': '"old-version"' } })
  assert.equal(changed.status, 200)
  assert.equal((await changed.arrayBuffer()).byteLength, 1024)
  const invalidRange = await request(contentPath, { headers: { ...credentials, range: 'bytes=2048-2050' } })
  assert.equal(invalidRange.status, 416)
  assert.equal(invalidRange.headers.get('content-range'), 'bytes */1024')
  mediaHeaders(invalidRange)

  const unknown = await request('/media/daily-recordings/00000000-0000-0000-0000-000000000000/content', { headers: credentials })
  assert.equal(unknown.status, 404)
  mediaHeaders(unknown)
  const beforeRejections = await metrics()
  for (const path of [playlistPath, segmentPath, contentPath]) {
    for (const [cookie, status] of [[undefined, 401], ['scrap_session=expired', 401], ['scrap_session=forbidden', 403], ['scrap_session=unavailable', 500]]) {
      const headers = { ...credentials }
      if (cookie === undefined) delete headers.cookie
      else headers.cookie = cookie
      const response = await request(`${path}?token=synthetic-bypass-token`, { headers })
      assert.equal(response.status, status)
      mediaHeaders(response)
    }
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      assert.equal((await request(path, { method, headers: credentials })).status, 405, `${method} ${path}`)
    }
  }
  for (const path of [
    '/media/daily-recordings/not-a-uuid/content',
    '/media/daily-recordings/------------------------------------/content',
    `${base}/exports`, `${base}/hls/private.m3u8`, `${base}/media/private.mp4`,
    `${base}/media/.hidden.ts`, `${base}/media/${'a'.repeat(129)}.ts`,
    `${base}/media/segment-02.ts/extra`,
    `${base}/media/../hls/index.m3u8`,
    `${base}/media/%2e%2e/hls/index.m3u8`,
    `${base}/media/%2f..%2fhls%2findex.m3u8`,
    `${base}/media/segment%2d02.ts`,
    `${base}/%68ls/index.m3u8`,
  ]) {
    assert.equal(await rawRequest(path, { headers: credentials }), 404, path)
  }
  const afterRejections = await metrics()
  assert.equal(afterRejections.mediaRequests, beforeRejections.mediaRequests)
  assert.equal(afterRejections.authRequests, beforeRejections.authRequests + 12)
}

async function waitForFrontend() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await request('/healthz')
      if (response.ok) {
        return
      }
    } catch {
      // Nginx can still be starting.
    }
    await sleep(250)
  }
  throw new Error('Frontend container did not become ready.')
}

function websocketEcho(message) {
  return new Promise((resolvePromise, reject) => {
    const key = randomBytes(16).toString('base64')
    const socket = createConnection({ host: '127.0.0.1', port: hostPort })
    let data = Buffer.alloc(0)
    let handshakeComplete = false
    let timeout

    function finish(error, value) {
      clearTimeout(timeout)
      socket.destroy()
      if (error) {
        reject(error)
        return
      }
      resolvePromise(value)
    }

    socket.on('connect', () => {
      socket.write([
        'GET /contract-signaling/echo HTTP/1.1',
        `Host: 127.0.0.1:${hostPort}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        '',
        '',
      ].join('\r\n'))
    })

    socket.on('data', (chunk) => {
      data = Buffer.concat([data, chunk])
      if (!handshakeComplete) {
        const separator = data.indexOf('\r\n\r\n')
        if (separator === -1) {
          return
        }
        const handshake = data.subarray(0, separator).toString()
        try {
          assert.match(handshake, /^HTTP\/1\.1 101 /)
          assert.match(handshake, /Upgrade: websocket/i)
          assert.match(handshake, /X-Proxy-Test-Instance: /i)
        } catch (error) {
          finish(error)
          return
        }
        data = data.subarray(separator + 4)
        handshakeComplete = true
        const payload = Buffer.from(message)
        const mask = randomBytes(4)
        const masked = Buffer.from(payload)
        for (let index = 0; index < masked.length; index += 1) {
          masked[index] ^= mask[index % 4]
        }
        socket.write(Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), mask, masked]))
      }

      if (handshakeComplete && data.length >= 2) {
        const length = data[1] & 0x7f
        if (data.length >= length + 2) {
          finish(null, data.subarray(2, length + 2).toString())
        }
      }
    })

    socket.on('error', (error) => finish(error))
    timeout = setTimeout(() => finish(new Error('WebSocket test timed out.')), 5000)
  })
}

async function waitForInstance(expectedInstance) {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    try {
      const response = await request('/contract-api/echo')
      if (response.ok) {
        const body = await response.json()
        if (body.instance === expectedInstance) {
          return
        }
      }
    } catch {
      // DNS cache and the upstream restart may temporarily return a connection error.
    }
    await sleep(250)
  }
  throw new Error(`Nginx did not re-resolve the ${expectedInstance} upstream instance.`)
}

function startUpstream(instance) {
  run('docker', [
    'run', '--detach', '--name', upstreamName, '--network', network, '--network-alias', 'proxy-integration-upstream',
    '--env', `UPSTREAM_INSTANCE=${instance}`, upstreamImage,
  ])
}

try {
  run('docker', ['build', '--quiet', '--tag', upstreamImage, testDirectory])
  run('docker', ['network', 'create', network])
  startUpstream('first')
  await waitForHealthy(upstreamName)

  const upstreamDirectory = resolve(testDirectory, 'upstreams')
  const runtimeDirectory = resolve(testDirectory, 'runtime')
  const proxyMounts = [
    '--mount', `type=bind,src=${upstreamDirectory},dst=/etc/nginx/upstreams,readonly`,
    '--mount', `type=bind,src=${runtimeDirectory},dst=/etc/nginx/runtime,readonly`,
  ]
  run('docker', [
    'run', '--rm', '--read-only', '--tmpfs', '/tmp', '--network', network,
    ...proxyMounts, '--entrypoint', 'nginx', image, '-t',
  ])
  run('docker', [
    'run', '--detach', '--read-only', '--tmpfs', '/tmp',
    '--name', frontendName, '--network', network,
    '--publish', `127.0.0.1:${hostPort}:8080`,
    ...proxyMounts,
    image,
  ])

  await waitForFrontend()

  const apiResponse = await request('/contract-api/echo')
  assert.equal(apiResponse.status, 200)
  assert.match(apiResponse.headers.get('x-request-id') ?? '', /.+/)
  assert.equal(apiResponse.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(apiResponse.headers.get('x-frame-options'), 'DENY')
  assert.match(apiResponse.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/)
  assert.match(apiResponse.headers.get('permissions-policy') ?? '', /camera=\(\)/)
  const apiBody = await apiResponse.json()
  assert.equal(apiBody.connection, '')
  assert.match(apiBody.forwardedFor, /\d+\.\d+\.\d+\.\d+/)
  assert.equal(apiBody.forwardedProto, 'http')
  assert.match(apiBody.forwardedHost, /127\.0\.0\.1/)
  assert.equal(apiBody.requestId, apiResponse.headers.get('x-request-id'))

  const streamStartedAt = Date.now()
  const eventResponse = await request('/contract-events/stream')
  assert.equal(eventResponse.status, 200)
  assert.match(eventResponse.headers.get('content-type') ?? '', /^text\/event-stream/)
  assert.equal(eventResponse.headers.get('cache-control'), 'no-cache')
  const eventReader = eventResponse.body.getReader()
  const firstEvent = await eventReader.read()
  assert.equal(firstEvent.done, false)
  assert.match(Buffer.from(firstEvent.value).toString(), /event: monitoring\.snapshot/)
  assert(Date.now() - streamStartedAt < 800, 'SSE first event was buffered until the upstream response completed.')
  const secondEvent = await eventReader.read()
  assert.match(Buffer.from(secondEvent.value).toString(), /"loadPercent":73/)

  const whepResponse = await request('/contract-whep/streams/camera-main', {
    body: 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n',
    headers: { accept: 'application/sdp', 'content-type': 'application/sdp' },
    method: 'POST',
  })
  assert.equal(whepResponse.status, 201)
  assert.equal(whepResponse.headers.get('location'), '/contract-whep/sessions/session-1')
  assert.equal(whepResponse.headers.get('etag'), '"whep-proxy-v1"')
  assert.match(whepResponse.headers.get('x-forwarded-for-received') ?? '', /\d+\.\d+\.\d+\.\d+/)
  assert.equal(whepResponse.headers.get('x-forwarded-proto-received'), 'http')
  assert.match(whepResponse.headers.get('x-forwarded-host-received') ?? '', /127\.0\.0\.1/)
  assert.equal(whepResponse.headers.get('x-request-id-received'), whepResponse.headers.get('x-request-id'))
  assert.match(await whepResponse.text(), /a=ice-options:trickle/)

  const iceResponse = await request('/contract-whep/sessions/session-1', {
    body: 'a=candidate:contract\r\n',
    headers: { 'content-type': 'application/trickle-ice-sdpfrag', 'if-match': '"whep-proxy-v1"' },
    method: 'PATCH',
  })
  assert.equal(iceResponse.status, 204)
  const deleteSessionResponse = await request('/contract-whep/sessions/session-1', { method: 'DELETE' })
  assert.equal(deleteSessionResponse.status, 200)

  const queryResponse = await request('/not-found?token=must-not-appear-in-access-log')
  assert.equal(queryResponse.status, 200)

  assert.equal(await websocketEcho('first connection'), 'first connection')
  assert.equal(await websocketEcho('reconnected connection'), 'reconnected connection')

  const tooLarge = await request('/contract-api/echo', {
    method: 'POST',
    body: 'x'.repeat(17000),
  })
  assert.equal(tooLarge.status, 413)

  await sleep(1200)
  const rateStatuses = await Promise.all(Array.from({ length: 4 }, () => request('/contract-api/echo').then((response) => response.status)))
  assert(rateStatuses.includes(429), 'API rate limit did not reject an excessive burst.')

  await sleep(1200)
  const delayed = await request('/contract-api/delay')
  assert.equal(delayed.status, 504)

  run('docker', ['rm', '--force', upstreamName])
  startUpstream('second')
  await waitForHealthy(upstreamName)
  await waitForInstance('second')

  const config = run('docker', ['exec', frontendName, 'nginx', '-T'])
  assert.match(config, /proxy_buffering off;/)
  assert.match(config, /proxy_http_version 1\.1;/)
  assert.match(config, /proxy_set_header Upgrade \$http_upgrade;/)
  assert.match(config, /proxy_set_header Connection \$connection_upgrade;/)
  assert.match(config, /include \/etc\/nginx\/includes\/proxy-streaming\.conf;/)
  assert.match(config, /proxy_cache off;/)

  const logLines = run('docker', ['logs', frontendName]).split('\n')
  const structuredLog = logLines.find((line) => line.startsWith('{') && line.includes('"uri":"/not-found"'))
  assert(structuredLog, 'Structured access log was not written.')
  assert.doesNotMatch(structuredLog, /must-not-appear-in-access-log/)
  const parsedLog = JSON.parse(structuredLog)
  assert.equal(parsedLog.method, 'GET')
  assert.match(parsedLog.uri, /^\//)
  assert.match(parsedLog.request_id, /.+/)

  await verifyDailyGateway('/contract-proxy-metrics', 'proxy_test_api', 'proxy_test_api')

  run('docker', ['rm', '--force', frontendName])
  run('docker', [
    'run', '--detach', '--read-only', '--tmpfs', '/tmp',
    '--tmpfs', '/etc/nginx/conf.d:rw,uid=101,gid=101,mode=0755,size=1m',
    '--name', frontendName, '--network', network,
    '--publish', `127.0.0.1:${hostPort}:8080`,
    '--mount', `type=bind,src=${resolve(repositoryRoot, 'development/nginx-proxy.conf.template')},dst=/etc/nginx/templates/default.conf.template,readonly`,
    '--env', 'DASHBOARD_BACKEND_UPSTREAM=proxy-integration-upstream:18081',
    '--env', 'DASHBOARD_MEDIA_UPSTREAM=proxy-integration-upstream:18081',
    '--env', 'NGINX_ENVSUBST_FILTER=^DASHBOARD_(BACKEND|MEDIA)_UPSTREAM$',
    image,
  ])
  await waitForFrontend()
  run('docker', ['exec', frontendName, 'nginx', '-t'])

  const credentials = {
    cookie: 'scrap_session=proxy-viewer',
    authorization: 'Bearer synthetic-authorization',
    'proxy-authorization': 'Basic synthetic-proxy-authorization',
    'x-auth-token': 'synthetic-auth-token',
    'x-api-key': 'synthetic-api-key',
    'x-original-uri': '/media/private?token=synthetic-original-token',
    origin: 'https://dashboard.example.invalid',
    referer: 'https://dashboard.example.invalid/?token=synthetic-referer-token',
    range: 'bytes=100-199',
    'if-range': '"proxy-media-etag"',
  }
  const forwardedToBackend = await request('/api/v1/proxy-test/echo?token=synthetic-query-token', { headers: credentials })
  assert.equal(forwardedToBackend.status, 200)
  const backendEcho = await forwardedToBackend.json()
  assert.equal(backendEcho.url, '/api/v1/proxy-test/echo?token=synthetic-query-token')
  for (const [name, value] of Object.entries(credentials)) {
    assert.equal(backendEcho.headers[name], value, `Test client did not send ${name}.`)
  }

  const livePath = '/media/cameras/camera-main/live'
  const clipPath = '/media/clips/550e8400-e29b-41d4-a716-446655440000/content'
  for (const [path, upstreamPath] of [
    [`${livePath}?download=true&token=secret&api_key=synthetic-query-key`, '/api/v1/cameras/camera-main/live'],
    [`${clipPath}?download=true&token=secret`, '/api/v1/clips/550e8400-e29b-41d4-a716-446655440000/content?download=true'],
    [`${clipPath}?download=false&token=secret`, '/api/v1/clips/550e8400-e29b-41d4-a716-446655440000/content'],
    [`${clipPath}?token=secret`, '/api/v1/clips/550e8400-e29b-41d4-a716-446655440000/content'],
  ]) {
    const response = await request(path, { headers: credentials })
    assert.equal(response.status, 200, path)
    assert.equal(response.headers.get('set-cookie'), null)
    const body = await response.json()
    assert.equal(body.url, upstreamPath)
    assert.equal(body.method, 'GET')
    assert.deepEqual(body.headers, {
      host: 'development_media',
      range: 'bytes=100-199',
      'if-range': '"proxy-media-etag"',
    })
    const metrics = await (await request('/api/v1/proxy-test/metrics')).json()
    assert.deepEqual(metrics.lastAuthRequest, {
      url: '/api/v1/media/access',
      headers: { host: 'development_backend', cookie: credentials.cookie },
    })
  }

  const mediaBeforeRejection = await (await request('/api/v1/proxy-test/metrics')).json()
  for (const [cookie, expectedStatus] of [
    [null, 401],
    ['scrap_session=expired', 401],
    ['scrap_session=forbidden', 403],
    ['scrap_session=unavailable', 500],
  ]) {
    const headers = { ...credentials }
    if (cookie === null) {
      delete headers.cookie
    } else {
      headers.cookie = cookie
    }
    const response = await request(`${livePath}?token=synthetic-bypass-token`, { headers })
    assert.equal(response.status, expectedStatus, `Unexpected authentication result for ${cookie}.`)
  }
  for (const method of ['HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const response = await request(clipPath, { headers: credentials, method })
    assert.equal(response.status, 405, `${method} must not reach Media.`)
  }
  for (const path of ['/_development_media_access', '/media/cameras/camera-main/private', '/media/clips/not-a-uuid/content']) {
    const response = await request(path, { headers: credentials })
    assert.equal(response.status, 404, path)
  }
  const mediaAfterRejection = await (await request('/api/v1/proxy-test/metrics')).json()
  assert.equal(mediaAfterRejection.mediaRequests, mediaBeforeRejection.mediaRequests)
  assert.equal(mediaAfterRejection.authRequests, mediaBeforeRejection.authRequests + 4)

  await verifyDailyGateway('/api/v1/proxy-test/metrics', 'development_media', 'development_backend')

  run('docker', ['rm', '--force', frontendName])
  run('docker', [
    'run', '--detach', '--read-only', '--tmpfs', '/tmp',
    '--name', frontendName, '--network', network,
    '--publish', `127.0.0.1:${hostPort}:8080`,
    '--mount', `type=bind,src=${upstreamDirectory},dst=/etc/nginx/upstreams,readonly`,
    '--mount', `type=bind,src=${resolve(repositoryRoot, 'integration/nginx/runtime.conf')},dst=/etc/nginx/runtime/integration.conf,readonly`,
    image,
  ])
  await waitForFrontend()
  run('docker', ['exec', frontendName, 'nginx', '-t'])
  await verifyDailyGateway('/api/v1/proxy-test/metrics', 'integration_media', 'integration_backend')

  console.log(`Verified reverse proxy integration for ${image}.`)
} finally {
  runQuietly('docker', ['rm', '--force', frontendName])
  runQuietly('docker', ['rm', '--force', upstreamName])
  runQuietly('docker', ['network', 'rm', network])
  runQuietly('docker', ['image', 'rm', upstreamImage])
}
