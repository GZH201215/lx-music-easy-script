// 模拟 LX Music 开放 API，用于端到端验证脚本
const http = require('http')

const PORT = 23330

const LRC = [
  '[00:00.00]First line',
  '[00:03.00]Second line',
  '[00:06.00]Third line',
  '[00:30.00]Fourth line',
].join('\n')
const TLRC = [
  '[00:00.00]第一句',
  '[00:03.00]第二句',
  '[00:06.00]第三句',
  '[00:30.00]第四句',
].join('\n')

const st = {
  status: 'playing',
  name: 'Test Song',
  singer: 'Singer A',
  albumName: 'Album X',
  picUrl: '',
  progress: 1.0,
  duration: 200,
  playbackRate: 1,
  lyricLineText: 'First line',
  lyricLineAllText: 'First line\n第一句',
  collect: false,
  volume: 60,
  mute: false,
}

const calls = []
const clients = new Set()
let down = false

const KEYS = Object.keys(st)

function broadcast() {
  for (const res of clients) {
    for (const k of KEYS) {
      res.write(`event: ${k}\n`)
      res.write(`data: ${JSON.stringify(st[k])}\n\n`)
    }
  }
}

function lyricAt(t) {
  if (t < 3) return [0, 'First line', '第一句']
  if (t < 6) return [1, 'Second line', '第二句']
  if (t < 30) return [2, 'Third line', '第三句']
  return [3, 'Fourth line', '第四句']
}

setInterval(() => {
  if (down) return
  if (st.status === 'playing') {
    st.progress = Math.min(st.duration, +(st.progress + 0.3).toFixed(2))
    const [, text, tr] = lyricAt(st.progress)
    st.lyricLineText = text
    st.lyricLineAllText = text + '\n' + tr
  }
  if (clients.size) broadcast()
}, 300)

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>page</title></head>
<body style="font-family:sans-serif">
<h1 id="hello">Host Page</h1>
<p><a href="#x" id="link">a link</a></p>
<div id="clickspace" style="width:300px;height:200px;background:#eee">click area</div>
<script>window.__pageClicks = 0; document.addEventListener('click', e => { if (!e.target.closest || !e.target.closest('#lx-music-easy-script')) window.__pageClicks++ })</script>
</body></html>`

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1')
  const p = u.pathname
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json; charset=utf-8' }
  const ok = () => { res.writeHead(200, cors); res.end('OK') }

  if (p === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(PAGE)
    return
  }
  if (p === '/__calls') {
    res.writeHead(200, cors)
    res.end(JSON.stringify(calls))
    return
  }
  if (p === '/__reset') { calls.length = 0; ok(); return }
  if (p === '/__down') {
    down = true
    for (const c of clients) { try { c.end('bye') } catch (e) { /* ignore */ } }
    clients.clear()
    ok()
    return
  }
  if (p === '/__up') { down = false; ok(); return }

  if (down) {
    res.writeHead(500, cors)
    res.end('down')
    return
  }

  switch (p) {
    case '/status':
      calls.push(p)
      res.writeHead(200, cors)
      res.end(JSON.stringify(st))
      return
    case '/lyric-all':
      calls.push(p)
      res.writeHead(200, cors)
      res.end(JSON.stringify({ lyric: LRC, tlyric: TLRC, rlyric: '', lxlyric: '' }))
      return
    case '/subscribe-player-status':
      calls.push(p)
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        Connection: 'keep-alive',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
      })
      clients.add(res)
      req.on('close', () => clients.delete(res))
      broadcast()
      return
    case '/play': st.status = 'playing'; calls.push(p); ok(); broadcast(); return
    case '/pause': st.status = 'paused'; calls.push(p); ok(); broadcast(); return
    case '/skip-next': st.name = 'Next Song'; st.progress = 0; calls.push(p); ok(); broadcast(); return
    case '/skip-prev': st.name = 'Prev Song'; st.progress = 0; calls.push(p); ok(); broadcast(); return
    case '/seek': {
      const off = parseFloat(u.searchParams.get('offset'))
      if (Number.isNaN(off) || off < 0 || off > st.duration) {
        res.writeHead(400, cors); res.end('Invalid offset'); return
      }
      st.progress = off
      const [, text, tr] = lyricAt(off)
      st.lyricLineText = text
      st.lyricLineAllText = text + '\n' + tr
      calls.push(p + '?offset=' + u.searchParams.get('offset'))
      ok(); broadcast(); return
    }
    case '/volume': {
      const v = parseInt(u.searchParams.get('volume'), 10)
      if (Number.isNaN(v) || v < 0 || v > 100) { res.writeHead(400, cors); res.end('Invalid volume'); return }
      st.volume = v
      calls.push(p + '?volume=' + v)
      ok(); broadcast(); return
    }
    case '/mute': {
      const m = u.searchParams.get('mute')
      if (m !== 'true' && m !== 'false') { res.writeHead(400, cors); res.end('Invalid mute'); return }
      st.mute = m === 'true'
      calls.push(p + '?mute=' + m)
      ok(); broadcast(); return
    }
    case '/collect': st.collect = true; calls.push(p); ok(); broadcast(); return
    case '/uncollect': st.collect = false; calls.push(p); ok(); broadcast(); return
    default:
      res.writeHead(401, cors); res.end('Forbidden'); return
  }
})

server.listen(PORT, '127.0.0.1', () => console.log('mock-lx listening on', PORT))

process.on('SIGTERM', () => { server.close(); process.exit(0) })