import { connect } from 'cloudflare:sockets'

const FIXED_UUID = '2eb5a0d9-3f07-4537-93db-e25d2ecbc473'

const RE_PROXY_PATH = /\/(proxyip[.=]|pyip=|ip=)(.+)/
const RE_TP_PORT = /\.tp(\d+)/

const TEXT_DECODER = new TextDecoder()
const TEXT_ENCODER = new TextEncoder()

const FIXED_UUID_BYTES = (() => {
  if (!FIXED_UUID) return null
  const hex = FIXED_UUID.replace(/-/g, '')
  if (hex.length !== 32) return null
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16)
  return bytes
})()

const COMMAND_TCP = 1
const COMMAND_UDP = 2
const DNS_PORT = 53
const ADDR_TYPE_IPV4 = 1
const ADDR_TYPE_DOMAIN = 2
const ADDR_TYPE_IPV6 = 3
const VLESS_RESP_HEADER = new Uint8Array([0, 0])

export default {
  async fetch(request) {
    try {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('nhìn cái đếch giề???', {
          status: 200,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        })
      }

      const url = new URL(request.url)
      let proxyIP = url.searchParams.get('proxyip') || ''
      if (!proxyIP) {
        const proxyMatch = url.pathname.toLowerCase().match(RE_PROXY_PATH)
        if (proxyMatch) {
          proxyIP = proxyMatch[1] === 'proxyip.' ? `proxyip.${proxyMatch[2]}` : proxyMatch[2]
        }
      }
      if (!proxyIP) {
        proxyIP = request.cf && request.cf.colo ? `${request.cf.colo}.proxyip.cmliussss.net` : 'proxyip.cmliussss.net'
      }

      const [proxyHost, proxyPort] = resolveHostPort(proxyIP)
      return await handleVlessWebSocket(request, proxyHost, proxyPort)
    } catch (err) {
      return new Response(err?.stack ?? String(err), { status: 500 })
    }
  }
}

async function handleVlessWebSocket(request, proxyHost, proxyPort) {
  const [clientWS, serverWS] = Object.values(new WebSocketPair())
  serverWS.accept()

  let remoteSocket = null
  let isDns = false
  let udpStreamWrite = null

  const cleanup = () => {
    if (remoteSocket) {
      try { remoteSocket.close() } catch {}
      remoteSocket = null
    }
    if (serverWS.readyState === 1 || serverWS.readyState === 0) {
      try { serverWS.close() } catch {}
    }
  }

  serverWS.addEventListener('close', cleanup)
  serverWS.addEventListener('error', cleanup)

  const earlyDataHeader = request.headers.get('sec-websocket-protocol') || ''
  const wsReadable = createWebSocketReadableStream(serverWS, earlyDataHeader)

  wsReadable
    .pipeTo(
      new WritableStream({
        async write(chunk) {
          if (isDns && udpStreamWrite) return udpStreamWrite(chunk)

          if (remoteSocket) {
            const writer = remoteSocket.writable.getWriter()
            await writer.write(chunk)
            writer.releaseLock()
            return
          }

          const result = parseVlessHeader(chunk)
          if (result.hasError) throw new Error(result.message)

          const vlessRespHeader = VLESS_RESP_HEADER
          const rawClientData = chunk.slice(result.rawDataIndex)

          if (result.isUDP) {
            if (result.portRemote === DNS_PORT) {
              isDns = true
              const { write } = await handleUdpOutbound(serverWS, vlessRespHeader)
              udpStreamWrite = write
              udpStreamWrite(rawClientData)
              return
            }
            throw new Error('UDP proxy only supports DNS (port 53)')
          }

          async function retryViaProxy() {
            try {
              if (remoteSocket) {
                try { remoteSocket.close() } catch {}
              }
              const tcpSocket = await connect({ hostname: proxyHost, port: proxyPort }, { allowHalfOpen: true })
              remoteSocket = tcpSocket
              const writer = tcpSocket.writable.getWriter()
              await writer.write(rawClientData)
              writer.releaseLock()
              pipeRemoteToWebSocket(tcpSocket, serverWS, vlessRespHeader, null)
            } catch {
              cleanup()
            }
          }

          try {
            const tcpSocket = await connect({ hostname: result.addressRemote, port: result.portRemote }, { allowHalfOpen: true })
            remoteSocket = tcpSocket
            const writer = tcpSocket.writable.getWriter()
            await writer.write(rawClientData)
            writer.releaseLock()
            pipeRemoteToWebSocket(tcpSocket, serverWS, vlessRespHeader, retryViaProxy)
          } catch {
            await retryViaProxy()
          }
        },
        close() {
          cleanup()
        }
      })
    )
    .catch(() => {
      cleanup()
    })

  return new Response(null, { status: 101, webSocket: clientWS })
}

function createWebSocketReadableStream(ws, earlyDataHeader) {
  return new ReadableStream({
    start(controller) {
      ws.addEventListener('message', event => controller.enqueue(event.data))
      ws.addEventListener('close', () => controller.close())
      ws.addEventListener('error', err => controller.error(err))

      if (earlyDataHeader) {
        try {
          const decoded = atob(earlyDataHeader.replace(/-/g, '+').replace(/_/g, '/'))
          const data = Uint8Array.from(decoded, c => c.charCodeAt(0))
          controller.enqueue(data.buffer)
        } catch {}
      }
    }
  })
}

function parseVlessHeader(buffer) {
  if (buffer.byteLength < 24) return { hasError: true, message: 'Invalid header length' }

  const view = ArrayBuffer.isView(buffer)
    ? new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    : new DataView(buffer)

  if (FIXED_UUID_BYTES && !uuidBytesEqual(buffer, 1, FIXED_UUID_BYTES)) {
    return { hasError: true, message: 'Invalid user' }
  }

  const optionsLength = view.getUint8(17)
  const command = view.getUint8(18 + optionsLength)
  let isUDP = false

  if (command === COMMAND_TCP) {
  } else if (command === COMMAND_UDP) {
    isUDP = true
  } else {
    return { hasError: true, message: 'Unsupported command' }
  }

  let offset = 19 + optionsLength
  const port = view.getUint16(offset)
  offset += 2
  const addressType = view.getUint8(offset++)
  let address = ''

  switch (addressType) {
    case ADDR_TYPE_IPV4:
      address = `${view.getUint8(offset)}.${view.getUint8(offset + 1)}.${view.getUint8(offset + 2)}.${view.getUint8(offset + 3)}`
      offset += 4
      break
    case ADDR_TYPE_DOMAIN: {
      const domainLength = view.getUint8(offset++)
      address = TEXT_DECODER.decode(buffer.slice(offset, offset + domainLength))
      offset += domainLength
      break
    }
    case ADDR_TYPE_IPV6: {
      const ipv6 = new Array(8)
      for (let i = 0; i < 8; i++) {
        ipv6[i] = view.getUint16(offset).toString(16).padStart(4, '0')
        offset += 2
      }
      address = ipv6.join(':').replace(/(^|:)0+(\w)/g, '$1$2')
      break
    }
    default:
      return { hasError: true, message: 'Unsupported address type' }
  }

  return { hasError: false, addressRemote: address, portRemote: port, rawDataIndex: offset, isUDP, addressType }
}

function uuidBytesEqual(buffer, offset, expected) {
  const bytes = ArrayBuffer.isView(buffer)
    ? new Uint8Array(buffer.buffer, buffer.byteOffset + offset, 16)
    : new Uint8Array(buffer, offset, 16)
  for (let i = 0; i < 16; i++) {
    if (bytes[i] !== expected[i]) return false
  }
  return true
}

async function pipeRemoteToWebSocket(remoteSocket, ws, vlessHeader, retry = null) {
  const MAX_CHUNK_SIZE = 64 * 1024
  let headerSent = false
  let hasIncomingData = false
  const reader = remoteSocket.readable.getReader()

  const sendChunk = data => {
    if (ws.readyState !== 1) return
    if (data.byteLength <= MAX_CHUNK_SIZE) {
      ws.send(data)
      return
    }
    let offset = 0
    while (offset < data.byteLength) {
      const end = Math.min(offset + MAX_CHUNK_SIZE, data.byteLength)
      ws.send(data.subarray(offset, end))
      offset = end
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      hasIncomingData = true
      if (ws.readyState !== 1) break

      if (!headerSent) {
        const combined = new Uint8Array(vlessHeader.byteLength + value.byteLength)
        combined.set(new Uint8Array(vlessHeader), 0)
        combined.set(value, vlessHeader.byteLength)
        sendChunk(combined)
        headerSent = true
      } else {
        sendChunk(value)
      }
    }
    reader.releaseLock()

    if (!hasIncomingData && retry) {
      await retry()
      return
    }
    if (ws.readyState === 1) ws.close(1000, 'Normal closure')
  } catch {
    try { reader.releaseLock() } catch {}
    if (!hasIncomingData && retry) {
      await retry()
      return
    }
    if (ws.readyState === 1) ws.close(1011, 'Data transmission error')
  }
}

async function handleUdpOutbound(webSocket, vlessResponseHeader) {
  let isVlessHeaderSent = false

  const transformStream = new TransformStream({
    transform(chunk, controller) {
      const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength)
      const len = chunk.byteLength
      let index = 0
      while (index + 2 <= len) {
        const udpPacketLength = view.getUint16(index)
        index += 2
        if (index + udpPacketLength > len) break
        controller.enqueue(new Uint8Array(chunk.buffer, chunk.byteOffset + index, udpPacketLength))
        index += udpPacketLength
      }
    }
  })

  transformStream.readable
    .pipeTo(
      new WritableStream({
        async write(chunk) {
          const resp = await fetch('https://1.1.1.1/dns-query', {
            method: 'POST',
            headers: { 'content-type': 'application/dns-message' },
            body: chunk
          })
          const dnsQueryResult = await resp.arrayBuffer()
          const udpSize = dnsQueryResult.byteLength
          const udpSizeBuffer = new Uint8Array([(udpSize >> 8) & 0xff, udpSize & 0xff])

          if (webSocket.readyState === 1) {
            if (isVlessHeaderSent) {
              const out = new Uint8Array(2 + udpSize)
              out.set(udpSizeBuffer, 0)
              out.set(new Uint8Array(dnsQueryResult), 2)
              webSocket.send(out)
            } else {
              const out = new Uint8Array(vlessResponseHeader.byteLength + 2 + udpSize)
              out.set(vlessResponseHeader, 0)
              out.set(udpSizeBuffer, vlessResponseHeader.byteLength)
              out.set(new Uint8Array(dnsQueryResult), vlessResponseHeader.byteLength + 2)
              webSocket.send(out)
              isVlessHeaderSent = true
            }
          }
        }
      })
    )
    .catch(() => {})

  const writer = transformStream.writable.getWriter()
  return {
    write(chunk) {
      writer.write(chunk)
    }
  }
}

function resolveHostPort(proxyIP) {
  proxyIP = proxyIP.toLowerCase()
  let host = proxyIP
  let port = 443

  if (proxyIP.includes('.tp')) {
    const tpMatch = proxyIP.match(RE_TP_PORT)
    if (tpMatch) port = parseInt(tpMatch[1], 10)
    return [host, port]
  }

  if (proxyIP.includes(']:')) {
    const parts = proxyIP.split(']:')
    host = parts[0] + ']'
    port = parseInt(parts[1], 10) || port
  } else if (proxyIP.includes(':') && !proxyIP.startsWith('[')) {
    const colonIndex = proxyIP.lastIndexOf(':')
    host = proxyIP.slice(0, colonIndex)
    port = parseInt(proxyIP.slice(colonIndex + 1), 10) || port
  }

  return [host, port]
}
