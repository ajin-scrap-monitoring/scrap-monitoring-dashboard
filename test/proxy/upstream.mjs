import { createHash } from 'node:crypto'
import { createServer } from 'node:http'

const instance = process.env.UPSTREAM_INSTANCE ?? 'first'
let mediaRequests = 0
let authRequests = 0
let lastAuthRequest = null
let lastDailyRequest = null
const dailyId = '550e8400-e29b-41d4-a716-446655440000'
const dailySegmentId = '550e8400-e29b-41d4-a716-446655440001'

function encodeTextFrame(text) {
  const payload = Buffer.from(text)
  if (payload.length >= 126) {
    throw new Error('Test payload is too large.')
  }

  return Buffer.concat([Buffer.from([0x81, payload.length]), payload])
}

function decodeClientTextFrame(buffer) {
  const payloadLength = buffer[1] & 0x7f
  const masked = (buffer[1] & 0x80) !== 0
  const maskOffset = 2
  const payloadOffset = maskOffset + (masked ? 4 : 0)
  const payload = buffer.subarray(payloadOffset, payloadOffset + payloadLength)

  if (!masked) {
    return payload.toString()
  }

  const mask = buffer.subarray(maskOffset, payloadOffset)
  for (let index = 0; index < payload.length; index += 1) {
    payload[index] ^= mask[index % 4]
  }
  return payload.toString()
}

const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://proxy-fixture').pathname

  if (request.url === '/readyz') {
    response.writeHead(200, { 'content-type': 'text/plain' })
    response.end('ready\n')
    return
  }

  if (request.url === '/contract-api/delay') {
    setTimeout(() => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ instance }))
    }, 3000)
    return
  }

  if (request.url === '/contract-api/echo') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({
      instance,
      forwardedFor: request.headers['x-forwarded-for'] ?? '',
      forwardedHost: request.headers['x-forwarded-host'] ?? '',
      forwardedProto: request.headers['x-forwarded-proto'] ?? '',
      connection: request.headers.connection ?? '',
      requestId: request.headers['x-request-id'] ?? '',
    }))
    return
  }

  if (pathname === '/api/v1/media/access') {
    authRequests += 1
    lastAuthRequest = { url: request.url, headers: request.headers }
    const cookie = request.headers.cookie
    const status = cookie === 'scrap_session=proxy-viewer' ? 204
      : cookie === 'scrap_session=forbidden' ? 403
        : cookie === 'scrap_session=unavailable' ? 503 : 401
    response.writeHead(status)
    response.end()
    return
  }

  if (pathname === '/api/v1/proxy-test/echo') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ url: request.url, method: request.method, headers: request.headers }))
    return
  }

  if (pathname === '/api/v1/proxy-test/metrics') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ mediaRequests, authRequests, lastAuthRequest, lastDailyRequest }))
    return
  }

  if (pathname.startsWith('/api/v2/daily-recordings/')) {
    mediaRequests += 1
    lastDailyRequest = { url: request.url, method: request.method, headers: request.headers }
    const headers = {
      'cache-control': 'public, max-age=86400',
      'set-cookie': 'media_cookie=must-not-reach-browser',
      'x-powered-by': 'private-media',
      'content-location': pathname,
    }
    if (pathname === `/api/v2/daily-recordings/${dailyId}/hls/index.m3u8`) {
      const playlist = [
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        '#EXT-X-TARGETDURATION:10',
        '#EXTINF:10.000,',
        `/api/v2/daily-recordings/${dailyId}/media/${dailySegmentId}.ts`,
        '#EXT-X-DISCONTINUITY',
        '#EXTINF:10.000,',
        `/api/v2/daily-recordings/${dailyId}/media/segment-02.ts`,
        '#EXT-X-ENDLIST',
        '',
      ].join('\n')
      response.writeHead(200, { ...headers, 'content-type': 'application/vnd.apple.mpegurl', 'content-length': Buffer.byteLength(playlist) })
      response.end(request.method === 'HEAD' ? undefined : playlist)
      return
    }
    const content = pathname === `/api/v2/daily-recordings/${dailyId}/content`
    const segment = pathname === `/api/v2/daily-recordings/${dailyId}/media/${dailySegmentId}.ts`
      || pathname === `/api/v2/daily-recordings/${dailyId}/media/segment-02.ts`
    if (!content && !segment) {
      response.writeHead(404, { ...headers, 'content-type': 'application/json' })
      response.end(JSON.stringify({ code: 'RECORDING_NOT_FOUND' }))
      return
    }
    const bytes = Buffer.from(Array.from({ length: 1024 }, (_, index) => index % 251))
    const mediaHeaders = {
      ...headers,
      'content-type': content ? 'video/mp4' : 'video/mp2t',
      'accept-ranges': 'bytes',
      etag: '"proxy-media-etag"',
      'last-modified': 'Wed, 14 Oct 2026 12:00:00 GMT',
      'content-disposition': `${new URL(request.url, 'http://proxy-fixture').searchParams.get('download') === 'true' ? 'attachment' : 'inline'}; filename="daily-test.${content ? 'mp4' : 'ts'}"`,
    }
    const range = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range ?? '')
    if (range && (!request.headers['if-range'] || request.headers['if-range'] === mediaHeaders.etag)) {
      const start = Number(range[1])
      const end = Math.min(Number(range[2]), bytes.length - 1)
      if (start > end || start >= bytes.length) {
        response.writeHead(416, { ...mediaHeaders, 'content-range': `bytes */${bytes.length}` })
        response.end()
        return
      }
      response.writeHead(206, { ...mediaHeaders, 'content-range': `bytes ${start}-${end}/${bytes.length}`, 'content-length': end - start + 1 })
      response.end(request.method === 'HEAD' ? undefined : bytes.subarray(start, end + 1))
      return
    }
    response.writeHead(200, { ...mediaHeaders, 'content-length': bytes.length })
    response.end(request.method === 'HEAD' ? undefined : bytes)
    return
  }

  if (pathname === '/api/v1/cameras/camera-main/live'
    || pathname === '/api/v1/clips/550e8400-e29b-41d4-a716-446655440000/content') {
    mediaRequests += 1
    response.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'media_cookie=must-not-reach-browser' })
    response.end(JSON.stringify({ url: request.url, method: request.method, headers: request.headers }))
    return
  }

  if (request.url === '/contract-events/stream') {
    response.writeHead(200, {
      'cache-control': 'no-cache',
      'content-type': 'text/event-stream',
    })
    response.flushHeaders()
    response.write('id: 1\nevent: monitoring.snapshot\ndata: {"loadPercent":72}\n\n')
    setTimeout(() => {
      response.end('id: 2\nevent: monitoring.snapshot\ndata: {"loadPercent":73}\n\n')
    }, 1200)
    return
  }

  if (request.url === '/contract-whep/streams/camera-main' && request.method === 'POST') {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      if (!body.includes('v=0') || request.headers['content-type'] !== 'application/sdp') {
        response.writeHead(422)
        response.end()
        return
      }
      response.writeHead(201, {
        'content-type': 'application/sdp',
        etag: '"whep-proxy-v1"',
        location: '/contract-whep/sessions/session-1',
        'x-forwarded-for-received': request.headers['x-forwarded-for'] ?? '',
        'x-forwarded-host-received': request.headers['x-forwarded-host'] ?? '',
        'x-forwarded-proto-received': request.headers['x-forwarded-proto'] ?? '',
        'x-request-id-received': request.headers['x-request-id'] ?? '',
      })
      response.end('v=0\r\na=ice-options:trickle\r\na=contract-answer\r\n')
    })
    return
  }

  if (request.url === '/contract-whep/sessions/session-1' && request.method === 'PATCH') {
    if (request.headers['if-match'] !== '"whep-proxy-v1"') {
      response.writeHead(412)
      response.end()
      return
    }
    response.writeHead(204)
    response.end()
    return
  }

  if (request.url === '/contract-whep/sessions/session-1' && request.method === 'DELETE') {
    response.writeHead(200)
    response.end()
    return
  }

  response.writeHead(404)
  response.end()
})

server.on('upgrade', (request, socket) => {
  if (request.url !== '/contract-signaling/echo' || request.headers.upgrade !== 'websocket') {
    socket.destroy()
    return
  }

  const key = request.headers['sec-websocket-key']
  if (typeof key !== 'string') {
    socket.destroy()
    return
  }

  const accept = createHash('sha1')
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64')
  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Connection: Upgrade',
    'Upgrade: websocket',
    `Sec-WebSocket-Accept: ${accept}`,
    `X-Proxy-Test-Instance: ${instance}`,
    '',
    '',
  ].join('\r\n'))

  socket.once('data', (buffer) => {
    socket.write(encodeTextFrame(decodeClientTextFrame(buffer)))
  })
})

server.listen(18081, '0.0.0.0')

process.on('SIGTERM', () => server.close())
