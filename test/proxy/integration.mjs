import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createConnection } from 'node:net'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const image = process.argv[2]
if (!image) {
  throw new Error('Usage: node test/proxy/integration.mjs <frontend-image>')
}

const testDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(testDirectory, '../..')
const suffix = `${process.pid}-${Date.now()}`
const network = `proxy-integration-${suffix}`
const upstreamName = 'proxy-integration-upstream'
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
    'run', '--detach', '--name', upstreamName, '--network', network,
    '--env', `UPSTREAM_INSTANCE=${instance}`, upstreamImage,
  ])
}

try {
  runQuietly('docker', ['rm', '--force', upstreamName])
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

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await request('/healthz')
      if (response.ok) {
        break
      }
    } catch {
      // Nginx can still be starting.
    }
    if (attempt === 19) {
      throw new Error('Frontend container did not become ready.')
    }
    await sleep(250)
  }

  const apiResponse = await request('/contract-api/echo')
  assert.equal(apiResponse.status, 200)
  assert.match(apiResponse.headers.get('x-request-id') ?? '', /.+/)
  const apiBody = await apiResponse.json()
  assert.match(apiBody.forwardedFor, /\d+\.\d+\.\d+\.\d+/)
  assert.equal(apiBody.forwardedProto, 'http')
  assert.match(apiBody.forwardedHost, /127\.0\.0\.1/)
  assert.equal(apiBody.requestId, apiResponse.headers.get('x-request-id'))

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

  const logLines = run('docker', ['logs', frontendName]).split('\n')
  const structuredLog = logLines.find((line) => line.startsWith('{') && line.includes('"method":"GET"'))
  assert(structuredLog, 'Structured access log was not written.')
  assert.doesNotMatch(structuredLog, /must-not-appear-in-access-log/)
  const parsedLog = JSON.parse(structuredLog)
  assert.equal(parsedLog.method, 'GET')
  assert.match(parsedLog.uri, /^\//)
  assert.match(parsedLog.request_id, /.+/)

  console.log(`Verified reverse proxy integration for ${image}.`)
} finally {
  runQuietly('docker', ['rm', '--force', frontendName])
  runQuietly('docker', ['rm', '--force', upstreamName])
  runQuietly('docker', ['network', 'rm', network])
  runQuietly('docker', ['image', 'rm', upstreamImage])
}
