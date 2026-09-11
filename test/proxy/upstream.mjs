import { createHash } from 'node:crypto'
import { createServer } from 'node:http'

const instance = process.env.UPSTREAM_INSTANCE ?? 'first'

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
      requestId: request.headers['x-request-id'] ?? '',
    }))
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
