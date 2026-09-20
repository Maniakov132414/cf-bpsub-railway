import { connect } from 'cloudflare:sockets'

const FIXED_UUID = '2eb5a0d9-3f07-4537-93db-e25d2ecbc473'

let proxyIP = ''
let socks5ProxyType = null
let enableGlobalSocks5 = false
let socks5Account = ''
let parsedSocks5Address = {}

const RE_PROXY_PATH = /\/(proxyip[.=]|pyip=|ip=)(.+)/
const RE_SOCKS_PATH_1 = /\/(socks5?):\/?\/?(.+)/i
const RE_SOCKS_PATH_2 = /\/(g?s5|socks5)=(.+)/i
const RE_BASE64 = /^(?:[A-Z0-9+/]{4})*(?:[A-Z0-9+/]{2}==|[A-Z0-9+/]{3}=)?$/i
const RE_NON_DIGIT = /[^\d]/g
const RE_IPV6_BRACKET = /^\[.*\]$/
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
const EMPTY_UINT8 = new Uint8Array(0)
const VLESS_RESP_HEADER = new Uint8Array([0, 0])

const HEARTBEAT_INTERVAL = 30000
const activeSockets = new Set()
let heartbeatTimer = null

function ensureHeartbeat() {
    if (heartbeatTimer) return
    heartbeatTimer = setInterval(() => {
        for (const ws of activeSockets) {
            if (ws.readyState === 1) {
                try {
                    ws.send(EMPTY_UINT8)
                } catch {
                    activeSockets.delete(ws)
                }
            } else {
                activeSockets.delete(ws)
            }
        }
        if (activeSockets.size === 0) {
            clearInterval(heartbeatTimer)
            heartbeatTimer = null
        }
    }, HEARTBEAT_INTERVAL)
}

export default {
    async fetch(request) {
        try {
            if (request.headers.get('Upgrade') !== 'websocket') {
                return new Response('Hello World!', { status: 200 })
            }

            proxyIP = proxyIP || (request.cf && request.cf.colo ? request.cf.colo + '.proxyip.cmliussss.net' : 'proxyip.cmliussss.net')
            await parseProxyParams(request)

            const [proxyHost, proxyPort] = resolveHostPort(proxyIP)
            return await handleVlessWebSocket(request, {
                parsedSocks5Address,
                proxyType: socks5ProxyType,
                enableGlobalSocks5,
                proxyHost,
                proxyPort
            })
        } catch (err) {
            return new Response(err?.stack ?? String(err), { status: 500 })
        }
    }
}

async function handleVlessWebSocket(request, config) {
    const { parsedSocks5Address, proxyType, enableGlobalSocks5, proxyHost, proxyPort } = config
    const [clientWS, serverWS] = Object.values(new WebSocketPair())

    serverWS.accept()
    activeSockets.add(serverWS)
    ensureHeartbeat()
    serverWS.addEventListener('close', () => activeSockets.delete(serverWS))
    serverWS.addEventListener('error', () => activeSockets.delete(serverWS))

    const earlyDataHeader = request.headers.get('sec-websocket-protocol') || ''
    const wsReadable = createWebSocketReadableStream(serverWS, earlyDataHeader)
    let remoteSocket = null
    let udpStreamWrite = null
    let isDns = false

    wsReadable
        .pipeTo(
            new WritableStream({
                async write(chunk) {
                    if (isDns && udpStreamWrite) return udpStreamWrite(chunk)

                    if (remoteSocket) {
                        try {
                            const writer = remoteSocket.writable.getWriter()
                            await writer.write(chunk)
                            writer.releaseLock()
                        } catch (err) {
                            closeSocket(remoteSocket)
                            throw err
                        }
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

                    async function connectDirect(address, port) {
                        const tcpSocket = await connect({ hostname: address, port }, { allowHalfOpen: true })
                        remoteSocket = tcpSocket
                        const writer = tcpSocket.writable.getWriter()
                        await writer.write(rawClientData)
                        writer.releaseLock()
                        return tcpSocket
                    }

                    async function connectViaSocks5(address, port) {
                        const tcpSocket = await socks5Connect(result.addressType, address, port, parsedSocks5Address)
                        remoteSocket = tcpSocket
                        const writer = tcpSocket.writable.getWriter()
                        await writer.write(rawClientData)
                        writer.releaseLock()
                        return tcpSocket
                    }

                    async function retry(retryCount = 0) {
                        try {
                            let tcpSocket
                            if (proxyType === 'socks5') {
                                tcpSocket = await socks5Connect(result.addressType, result.addressRemote, result.portRemote, parsedSocks5Address)
                            } else {
                                tcpSocket = await connect({ hostname: proxyHost, port: proxyPort }, { allowHalfOpen: true })
                            }
                            remoteSocket = tcpSocket
                            const writer = tcpSocket.writable.getWriter()
                            await writer.write(rawClientData)
                            writer.releaseLock()
                            tcpSocket.closed
                                .catch(() => {})
                                .finally(() => {
                                    if (serverWS.readyState === 1) serverWS.close(1000, 'Connection closed')
                                })
                            pipeRemoteToWebSocket(tcpSocket, serverWS, vlessRespHeader, retry, retryCount + 1)
                        } catch (err) {
                            closeSocket(remoteSocket)
                            serverWS.close(1011, 'Proxy connection failed: ' + (err?.message ?? err))
                        }
                    }

                    try {
                        const tcpSocket = enableGlobalSocks5 && proxyType === 'socks5' ? await connectViaSocks5(result.addressRemote, result.portRemote) : await connectDirect(result.addressRemote, result.portRemote)
                        pipeRemoteToWebSocket(tcpSocket, serverWS, vlessRespHeader, retry, 0)
                    } catch (err) {
                        closeSocket(remoteSocket)
                        serverWS.close(1011, 'Connection failed: ' + (err?.message ?? err))
                    }
                },
                close() {
                    if (remoteSocket) closeSocket(remoteSocket)
                }
            })
        )
        .catch(err => {
            closeSocket(remoteSocket)
            serverWS.close(1011, 'Internal error: ' + (err?.message ?? err))
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
            address = view.getUint8(offset) + '.' + view.getUint8(offset + 1) + '.' + view.getUint8(offset + 2) + '.' + view.getUint8(offset + 3)
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
    for (let i = 0; i < 16; i++) if (bytes[i] !== expected[i]) return false
    return true
}

async function pipeRemoteToWebSocket(remoteSocket, ws, vlessHeader, retry = null, retryCount = 0) {
    const MAX_RETRIES = 8
    const MAX_CHUNK_SIZE = 128 * 1024
    const BASE_RETRY_DELAY = 200

    let headerSent = false
    let hasIncomingData = false

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

    const reader = remoteSocket.readable.getReader()
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

        if (!hasIncomingData && retry && retryCount < MAX_RETRIES) {
            await new Promise(r => setTimeout(r, BASE_RETRY_DELAY * Math.pow(2, retryCount)))
            await retry(retryCount)
            return
        }
        if (ws.readyState === 1) ws.close(1000, 'Normal closure')
    } catch (err) {
        reader.releaseLock()
        closeSocket(remoteSocket)
        if (retry && retryCount < MAX_RETRIES) {
            await new Promise(r => setTimeout(r, BASE_RETRY_DELAY * Math.pow(2, retryCount)))
            await retry(retryCount)
            return
        }
        if (ws.readyState === 1) ws.close(1011, 'Data transmission error')
    }
}

function closeSocket(socket) {
    if (socket) {
        try {
            socket.close()
        } catch {}
    }
}

async function socks5Connect(addressType, addressRemote, portRemote, parsedSocks5Address) {
    const { username, password, hostname, port } = parsedSocks5Address
    const socket = connect({ hostname, port })
    const writer = socket.writable.getWriter()
    const reader = socket.readable.getReader()
    const encoder = TEXT_ENCODER

    await writer.write(new Uint8Array([5, 2, 0, 2]))
    let res = (await reader.read()).value
    if (res[0] !== 0x05) throw new Error(`SOCKS server version error: ${res[0]} expected: 5`)
    if (res[1] === 0xff) throw new Error('No acceptable methods')

    if (res[1] === 0x02) {
        if (!username || !password) throw new Error('Please provide username/password')
        const authRequest = new Uint8Array([1, username.length, ...encoder.encode(username), password.length, ...encoder.encode(password)])
        await writer.write(authRequest)
        res = (await reader.read()).value
        if (res[0] !== 0x01 || res[1] !== 0x00) throw new Error('Failed to authenticate with SOCKS server')
    }

    let dstAddr
    switch (addressType) {
        case ADDR_TYPE_IPV4:
            dstAddr = new Uint8Array([1, ...addressRemote.split('.').map(Number)])
            break
        case ADDR_TYPE_DOMAIN:
            dstAddr = new Uint8Array([3, addressRemote.length, ...encoder.encode(addressRemote)])
            break
        case ADDR_TYPE_IPV6:
            dstAddr = new Uint8Array([4, ...addressRemote.split(':').flatMap(x => [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2), 16)])])
            break
        default:
            throw new Error(`Invalid addressType: ${addressType}`)
    }

    const socksRequest = new Uint8Array([5, 1, 0, ...dstAddr, portRemote >> 8, portRemote & 0xff])
    await writer.write(socksRequest)
    res = (await reader.read()).value
    if (res[1] !== 0x00) throw new Error('Failed to open SOCKS connection')

    writer.releaseLock()
    reader.releaseLock()
    return socket
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

async function parseProxyParams(request) {
    const url = new URL(request.url)
    const { pathname, searchParams } = url
    const pathLower = pathname.toLowerCase()

    socks5Account = searchParams.get('socks5') || null
    enableGlobalSocks5 = searchParams.has('globalproxy')

    if (searchParams.has('proxyip')) {
        const rawIP = searchParams.get('proxyip')
        const parts = rawIP.includes(',') ? rawIP.split(',') : null
        proxyIP = parts ? parts[Math.floor(Math.random() * parts.length)] : rawIP
        return
    }

    const proxyMatch = pathLower.match(RE_PROXY_PATH)
    if (proxyMatch) {
        const rawIP = proxyMatch[1] === 'proxyip.' ? `proxyip.${proxyMatch[2]}` : proxyMatch[2]
        const parts = rawIP.includes(',') ? rawIP.split(',') : null
        proxyIP = parts ? parts[Math.floor(Math.random() * parts.length)] : rawIP
        return
    }

    let socksMatch
    if ((socksMatch = pathname.match(RE_SOCKS_PATH_1))) {
        socks5ProxyType = 'socks5'
        socks5Account = socksMatch[2].split('#')[0]
        enableGlobalSocks5 = true

        if (socks5Account.includes('@')) {
            const atIndex = socks5Account.lastIndexOf('@')
            let userPassword = socks5Account.substring(0, atIndex).replaceAll('%3D', '=')
            if (RE_BASE64.test(userPassword) && !userPassword.includes(':')) {
                userPassword = atob(userPassword)
            }
            socks5Account = `${userPassword}@${socks5Account.substring(atIndex + 1)}`
        }
    } else if ((socksMatch = pathname.match(RE_SOCKS_PATH_2))) {
        const type = socksMatch[1].toLowerCase()
        socks5Account = socksMatch[2]
        socks5ProxyType = 'socks5'
        enableGlobalSocks5 = type.startsWith('g') || enableGlobalSocks5
    }

    if (socks5Account) {
        try {
            parsedSocks5Address = await parseSocks5Account(socks5Account)
            socks5ProxyType = 'socks5'
        } catch {
            socks5ProxyType = null
        }
    } else {
        socks5ProxyType = null
    }
}

async function parseSocks5Account(address) {
    const lastAtIndex = address.lastIndexOf('@')
    const [latter, former] = lastAtIndex === -1 ? [address, undefined] : [address.substring(lastAtIndex + 1), address.substring(0, lastAtIndex)]

    let username, password, hostname, port

    if (former) {
        const formers = former.split(':')
        if (formers.length !== 2) throw new Error('Invalid SOCKS address format')
        ;[username, password] = formers
    }

    const latters = latter.split(':')
    if (latters.length > 2 && latter.includes(']:')) {
        port = Number(latter.split(']:')[1].replace(RE_NON_DIGIT, ''))
        hostname = latter.split(']:')[0] + ']'
    } else if (latters.length === 2) {
        port = Number(latters.pop().replace(RE_NON_DIGIT, ''))
        hostname = latters.join(':')
    } else {
        port = 80
        hostname = latter
    }

    if (isNaN(port)) throw new Error('Invalid SOCKS address format')

    if (hostname.includes(':') && !RE_IPV6_BRACKET.test(hostname)) {
        throw new Error('IPv6 address must be wrapped in brackets')
    }

    return { username, password, hostname, port }
}
