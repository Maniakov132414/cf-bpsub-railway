const state = {
  defaultHost: 'proxy.maniakov.bond',
  defaultUuid: '2eb5a0d9-3f07-4537-93db-e25d2ecbc473',
  defaultEchDomain: 'cloudflare-ech.com',
  defaultEchDoh: 'https://dns.alidns.com/dns-query'
}

const inputHost = document.getElementById('inputHost')
const inputUuid = document.getElementById('inputUuid')
const inputEchDomain = document.getElementById('inputEchDomain')
const inputEchDoh = document.getElementById('inputEchDoh')

const linkSub = document.getElementById('linkSub')
const linkClash = document.getElementById('linkClash')
const linkSingbox = document.getElementById('linkSingbox')
const linkIps = document.getElementById('linkIps')
const btnOpenIps = document.getElementById('btnOpenIps')

const totalNodes = document.getElementById('totalNodes')
const jpNodes = document.getElementById('jpNodes')
const sgNodes = document.getElementById('sgNodes')
const usNodes = document.getElementById('usNodes')

async function loadServerInfo() {
  try {
    const res = await fetch('/api/info')
    if (res.ok) {
      const data = await res.json()
      state.defaultHost = data.config.host
      state.defaultUuid = data.config.uuid
      state.defaultEchDomain = data.config.echDomain
      state.defaultEchDoh = data.config.echDoh

      inputHost.value = state.defaultHost
      inputUuid.value = state.defaultUuid
      inputEchDomain.value = state.defaultEchDomain
      inputEchDoh.value = state.defaultEchDoh

      totalNodes.textContent = data.stats.totalNodes
      jpNodes.textContent = data.stats.jp
      sgNodes.textContent = data.stats.sg
      usNodes.textContent = data.stats.us
    }
  } catch (e) {
    console.error('Failed to load info:', e)
  }
  updateLinks()
}

function updateLinks() {
  const origin = window.location.origin
  const host = inputHost.value.trim()
  const uuid = inputUuid.value.trim()
  const echDomain = inputEchDomain.value.trim()
  const echDoh = inputEchDoh.value.trim()

  const params = new URLSearchParams()
  if (host && host !== state.defaultHost) params.set('host', host)
  if (uuid && uuid !== state.defaultUuid) params.set('uuid', uuid)
  if (echDomain && echDomain !== state.defaultEchDomain) params.set('echDomain', echDomain)
  if (echDoh && echDoh !== state.defaultEchDoh) params.set('echDoh', echDoh)

  const queryStr = params.toString() ? '?' + params.toString() : ''

  linkSub.value = `${origin}/sub${queryStr}`
  linkClash.value = `${origin}/clash${queryStr}`
  linkSingbox.value = `${origin}/singbox${queryStr}`
  linkIps.value = `${origin}/ips`
  btnOpenIps.href = `${origin}/ips`
}

function copyLink(elementId, btn) {
  const el = document.getElementById(elementId)
  if (!el) return

  el.select()
  el.setSelectionRange(0, 99999)
  navigator.clipboard.writeText(el.value).then(() => {
    const originalText = btn.textContent
    btn.textContent = '✓ Đã Sao Chép!'
    btn.style.background = '#10b981'
    setTimeout(() => {
      btn.textContent = originalText
      btn.style.background = ''
    }, 2000)
  })
}

// Event listeners
;[inputHost, inputUuid, inputEchDomain, inputEchDoh].forEach(input => {
  input.addEventListener('input', updateLinks)
})

document.getElementById('resetBtn').addEventListener('click', () => {
  inputHost.value = state.defaultHost
  inputUuid.value = state.defaultUuid
  inputEchDomain.value = state.defaultEchDomain
  inputEchDoh.value = state.defaultEchDoh
  updateLinks()
})

// Initialize
loadServerInfo()
