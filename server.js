import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = process.env.PORT || 3000

// Default configuration with environment overrides
const CONFIG = {
  uuid: process.env.VLESS_UUID || '2eb5a0d9-3f07-4537-93db-e25d2ecbc473',
  host: process.env.VLESS_HOST || 'proxy.maniakov.bond',
  path: process.env.VLESS_PATH || '/',
  echDomain: process.env.ECH_DOMAIN || 'cloudflare-ech.com',
  echDoh: process.env.ECH_DOH || 'https://dns.alidns.com/dns-query',
  subName: process.env.SUB_NAME || 'CF-BPSUB-ECH',
  updateIntervalHours: Number(process.env.UPDATE_INTERVAL_HOURS) || 12
}

const BEST_CF_SOURCES = [
  { url: 'https://bestcf.pages.dev/tiancheng/all.txt', name: 'TianCheng' },
  { url: 'https://bestcf.pages.dev/wetest/ipv4.txt', name: 'WeTest' },
  { url: 'https://bestcf.pages.dev/uouin/all.txt', name: 'UOUIN' },
  { url: 'https://bestcf.pages.dev/cfyes/ipv4.txt', name: 'CFYes' },
  { url: 'https://bestcf.pages.dev/vps789/top20.txt', name: 'VPS789' }
]

// Fallback high-performance clean Cloudflare Anycast IPs
const FALLBACK_IPS = [
  '104.16.123.96:443#🇯🇵 JP-Tokyo-01 - 104.16.123.96',
  '104.17.221.45:443#🇯🇵 JP-Tokyo-02 - 104.17.221.45',
  '172.64.150.83:443#🇸🇬 SG-Singapore-01 - 172.64.150.83',
  '172.64.151.37:443#🇸🇬 SG-Singapore-02 - 172.64.151.37',
  '104.18.70.83:443#🇺🇸 US-LosAngeles-01 - 104.18.70.83',
  '104.16.54.243:443#🇺🇸 US-SanJose-02 - 104.16.54.243',
  '104.17.149.202:443#🇭🇰 HK-HongKong-01 - 104.17.149.202',
  '162.159.192.1:443#⚡ CF-WARP-Anycast - 162.159.192.1'
]

// In-memory cache
let cachedNodes = []
let lastFetchTime = 0
const CACHE_TTL_MS = 15 * 60 * 1000 // 15 minutes

/**
 * Fetch and filter Clean IPs from BestCF sources
 */
async function fetchCleanIPs(force = false) {
  const now = Date.now()
  if (!force && cachedNodes.length > 0 && now - lastFetchTime < CACHE_TTL_MS) {
    return cachedNodes
  }

  const rawLines = []
  for (const src of BEST_CF_SOURCES) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 6000)
      const res = await fetch(src.url, { signal: controller.signal })
      clearTimeout(timeout)

      if (res.ok) {
        const text = await res.text()
        const lines = text.split('\n')
        rawLines.push(...lines)
      }
    } catch (e) {
      console.warn(`[BestCF] Fetch error from ${src.name}: ${e.message}`)
    }
  }

  // Sanitize: Replace all '|' with '-' (BPSUB compatibility fix)
  const sanitized = (rawLines.length > 0 ? rawLines : FALLBACK_IPS)
    .map(line => line.trim().replaceAll('|', '-'))
    .filter(line => line && line.includes(':') && line.includes('#'))

  const parsed = []
  const seenIPs = new Set()

  for (const line of sanitized) {
    const [addrPort, ...remarkParts] = line.split('#')
    const remark = remarkParts.join('#').trim()
    const [address, portStr] = addrPort.trim().split(':')
    const port = Number(portStr) || 443

    if (!address || seenIPs.has(address)) continue
    seenIPs.add(address)

    // Classify region
    let region = 'OTHER'
    let flag = '⚡'
    const fullText = (line + ' ' + remark).toLowerCase()

    if (/jp|nrt|hnd|kix|tokyo|japan|nhật|东京|大阪/.test(fullText)) {
      region = 'JP'
      flag = '🇯🇵'
    } else if (/sg|sin|singapore|sing|狮城/.test(fullText)) {
      region = 'SG'
      flag = '🇸🇬'
    } else if (/us|lax|sjc|sfo|ord|iad|sea|america|united states|mỹ|洛杉矶|圣何塞/.test(fullText)) {
      region = 'US'
      flag = '🇺🇸'
    } else if (/hk|hkg|hongkong|hong kong|香港/.test(fullText)) {
      region = 'HK'
      flag = '🇭🇰'
    }

    parsed.push({
      address,
      port,
      region,
      flag,
      remark: `${flag} [${region}] ${remark.slice(0, 35)}`
    })
  }

  // Select balanced mix: 10 JP, 10 SG, 10 US, 5 HK, 5 Others
  const jp = parsed.filter(n => n.region === 'JP').slice(0, 10)
  const sg = parsed.filter(n => n.region === 'SG').slice(0, 10)
  const us = parsed.filter(n => n.region === 'US').slice(0, 10)
  const hk = parsed.filter(n => n.region === 'HK').slice(0, 5)
  const others = parsed.filter(n => n.region === 'OTHER').slice(0, 5)

  let selected = [...jp, ...sg, ...us, ...hk, ...others]
  if (selected.length < 10) {
    selected = parsed.slice(0, 35)
  }

  cachedNodes = selected
  lastFetchTime = now
  console.log(`[BestCF] Refreshed ${selected.length} nodes (JP: ${jp.length}, SG: ${sg.length}, US: ${us.length}, HK: ${hk.length})`)
  return cachedNodes
}

/**
 * Build VLESS URI for a single clean IP
 */
function buildVlessUri(node, options = {}) {
  const uuid = options.uuid || CONFIG.uuid
  const host = options.host || CONFIG.host
  const path = options.path || CONFIG.path
  const echDomain = options.echDomain || CONFIG.echDomain
  const echDoh = options.echDoh || CONFIG.echDoh

  const echParam = `${echDomain}+${echDoh}`
  const name = node.remark || `${node.flag || '⚡'} CF-${node.address}`

  return `vless://${uuid}@${node.address}:${node.port}?encryption=none&security=tls&sni=${host}&fp=chrome&type=ws&host=${host}&path=${encodeURIComponent(path)}&ech=${encodeURIComponent(echParam)}#${encodeURIComponent(name)}`
}

/**
 * Generate Clash Meta / Mihomo Configuration
 */
function buildClashConfig(nodes, options = {}) {
  const uuid = options.uuid || CONFIG.uuid
  const host = options.host || CONFIG.host
  const path = options.path || CONFIG.path
  const echDomain = options.echDomain || CONFIG.echDomain

  const proxyNames = []
  const proxiesYaml = nodes.map(n => {
    const name = n.remark.replaceAll('"', '')
    proxyNames.push(name)
    return `  - name: "${name}"
    type: vless
    server: "${n.address}"
    port: ${n.port}
    uuid: "${uuid}"
    network: ws
    tls: true
    udp: true
    sni: "${host}"
    client-fingerprint: chrome
    ws-opts:
      path: "${path}"
      headers:
        Host: "${host}"
    ech:
      enable: true
      config: "${echDomain}"`
  }).join('\n')

  const namesList = proxyNames.map(p => `      - "${p}"`).join('\n')

  return `port: 7890
socks-port: 7891
mixed-port: 7892
allow-lan: false
mode: rule
log-level: info
ipv6: false

dns:
  enable: true
  listen: 0.0.0.0:1053
  ipv6: false
  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16
  nameserver:
    - 223.5.5.5
    - 119.29.29.29
    - https://dns.alidns.com/dns-query

proxies:
${proxiesYaml}

proxy-groups:
  - name: "⚡ TỔNG HỢP PROXY"
    type: select
    proxies:
      - "🚀 TỰ ĐỘNG CHỌN (URLTEST)"
      - "🛡️ DỰ PHÒNG (FALLBACK)"
      - "⚖️ CÂN BẰNG TẢI (LOADBALANCE)"
${namesList}

  - name: "🚀 TỰ ĐỘNG CHỌN (URLTEST)"
    type: url-test
    url: "http://cp.cloudflare.com/generate_204"
    interval: 300
    tolerance: 50
    proxies:
${namesList}

  - name: "🛡️ DỰ PHÒNG (FALLBACK)"
    type: fallback
    url: "http://cp.cloudflare.com/generate_204"
    interval: 300
    proxies:
${namesList}

  - name: "⚖️ CÂN BẰNG TẢI (LOADBALANCE)"
    type: load-balance
    url: "http://cp.cloudflare.com/generate_204"
    interval: 300
    strategy: round-robin
    proxies:
${namesList}

rules:
  - DOMAIN-SUFFIX,toapis.com,⚡ TỔNG HỢP PROXY
  - DOMAIN-KEYWORD,google,⚡ TỔNG HỢP PROXY
  - DOMAIN-KEYWORD,openai,⚡ TỔNG HỢP PROXY
  - DOMAIN-KEYWORD,anthropic,⚡ TỔNG HỢP PROXY
  - DOMAIN-KEYWORD,claude,⚡ TỔNG HỢP PROXY
  - DOMAIN-SUFFIX,youtube.com,⚡ TỔNG HỢP PROXY
  - DOMAIN-SUFFIX,netflix.com,⚡ TỔNG HỢP PROXY
  - GEOIP,CN,DIRECT
  - GEOIP,VN,DIRECT
  - MATCH,⚡ TỔNG HỢP PROXY
`
}

/**
 * Generate Sing-box Configuration
 */
function buildSingboxConfig(nodes, options = {}) {
  const uuid = options.uuid || CONFIG.uuid
  const host = options.host || CONFIG.host
  const path = options.path || CONFIG.path
  const echDomain = options.echDomain || CONFIG.echDomain

  const outbounds = nodes.map(n => ({
    type: 'vless',
    tag: n.remark,
    server: n.address,
    server_port: n.port,
    uuid: uuid,
    packet_encoding: 'xudp',
    tls: {
      enabled: true,
      server_name: host,
      utls: {
        enabled: true,
        fingerprint: 'chrome'
      },
      ech: {
        enabled: true,
        config: [echDomain]
      }
    },
    transport: {
      type: 'ws',
      path: path,
      headers: {
        Host: host
      }
    }
  }))

  const tags = nodes.map(n => n.remark)

  return JSON.stringify({
    log: { level: 'info', timestamp: true },
    dns: {
      servers: [
        { tag: 'dns_proxy', address: 'https://1.1.1.1/dns-query', detour: 'select' },
        { tag: 'dns_direct', address: 'https://223.5.5.5/dns-query', detour: 'direct' }
      ]
    },
    inbounds: [
      { type: 'mixed', tag: 'mixed-in', listen: '127.0.0.1', listen_port: 2080 }
    ],
    outbounds: [
      {
        type: 'selector',
        tag: 'select',
        outbounds: ['auto', 'direct', ...tags]
      },
      {
        type: 'urltest',
        tag: 'auto',
        outbounds: tags,
        url: 'http://cp.cloudflare.com/generate_204',
        interval: '3m'
      },
      ...outbounds,
      { type: 'direct', tag: 'direct' }
    ]
  }, null, 2)
}

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')))

// API: Current config & stats
app.get('/api/info', async (req, res) => {
  const nodes = await fetchCleanIPs()
  res.json({
    status: 'online',
    config: {
      uuid: req.query.uuid || CONFIG.uuid,
      host: req.query.host || CONFIG.host,
      echDomain: req.query.echDomain || CONFIG.echDomain,
      echDoh: req.query.echDoh || CONFIG.echDoh
    },
    stats: {
      totalNodes: nodes.length,
      jp: nodes.filter(n => n.region === 'JP').length,
      sg: nodes.filter(n => n.region === 'SG').length,
      us: nodes.filter(n => n.region === 'US').length,
      hk: nodes.filter(n => n.region === 'HK').length,
      lastUpdated: new Date(lastFetchTime).toISOString()
    }
  })
})

// API: Refresh nodes cache
app.post('/api/refresh', async (req, res) => {
  const nodes = await fetchCleanIPs(true)
  res.json({ success: true, count: nodes.length })
})

// Sub Endpoint: v2rayN / v2rayNG / Shadowrocket (Base64)
app.get('/sub', async (req, res) => {
  const nodes = await fetchCleanIPs()
  const vlessLinks = nodes.map(n => buildVlessUri(n, req.query))
  const base64Data = Buffer.from(vlessLinks.join('\n')).toString('base64')

  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Subscription-Userinfo', 'upload=0; download=0; total=1073741824000; expire=1893456000')
  res.setHeader('Profile-Update-Interval', String(CONFIG.updateIntervalHours))
  res.setHeader('Profile-Title', Buffer.from(CONFIG.subName).toString('base64'))
  res.send(base64Data)
})

// Sub Endpoint: Clash Meta / Mihomo (YAML)
app.get('/clash', async (req, res) => {
  const nodes = await fetchCleanIPs()
  const yamlConfig = buildClashConfig(nodes, req.query)

  res.setHeader('Content-Type', 'text/yaml; charset=utf-8')
  res.setHeader('Subscription-Userinfo', 'upload=0; download=0; total=1073741824000; expire=1893456000')
  res.setHeader('Profile-Update-Interval', String(CONFIG.updateIntervalHours))
  res.send(yamlConfig)
})

// Sub Endpoint: Sing-box (JSON)
app.get('/singbox', async (req, res) => {
  const nodes = await fetchCleanIPs()
  const jsonConfig = buildSingboxConfig(nodes, req.query)

  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.send(jsonConfig)
})

// Plain text VLESS list
app.get('/raw', async (req, res) => {
  const nodes = await fetchCleanIPs()
  const vlessLinks = nodes.map(n => buildVlessUri(n, req.query))
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.send(vlessLinks.join('\n'))
})

// Clean IPs list with '|' replaced by '-' (direct BPSUB compatibility)
app.get('/ips', async (req, res) => {
  const nodes = await fetchCleanIPs()
  const lines = nodes.map(n => `${n.address}:${n.port}#${n.remark}`)
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.send(lines.join('\n'))
})

// Health check for Railway
app.get('/health', (req, res) => {
  res.status(200).send('OK')
})

// Pre-fetch clean IPs on start
fetchCleanIPs().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[CF-BPSUB-Railway] Server listening on http://0.0.0.0:${PORT}`)
  })
})
