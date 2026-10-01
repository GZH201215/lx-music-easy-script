// ==UserScript==
// @name         LX Music 便捷脚本
// @namespace    lx-music-easy-script
// @version      1.0.0
// @description  在任意网页遥控桌面版 LX Music：查看播放状态与歌词、控制播放/进度/音量/收藏、搜索并播放。
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @grant        GM_getValue
// @grant        GM.getValue
// @grant        GM_setValue
// @grant        GM.setValue
// @grant        GM_registerMenuCommand
// @grant        GM.registerMenuCommand
// @connect      127.0.0.1
// @connect      localhost
// @run-at       document-idle
// @noframes
// @license      MIT
// ==/UserScript==

/*
 * 说明（内部实现笔记）
 *
 * 通道一：LX Music 开放 API（HTTP，默认 http://127.0.0.1:23330）
 *   - 状态：GET /status?filter=...        → 一次拿全：播放状态、歌曲、歌词行、进度、音量、收藏
 *   - 实时：GET /subscribe-player-status  → SSE，按字段名推送命名事件（event: progress / data: 12.3）
 *   - 控制：GET /play /pause /skip-next /skip-prev /seek?offset= /volume?volume=
 *           /mute?mute= /collect /uncollect
 *   - 请求统一走 GM_xmlhttpRequest：不受页面 CORS / CSP / 混合内容限制；
 *     SSE 走页面原生 EventSource（需 LX v2.8.0+ 的跨域头），失败自动退回轮询。
 *
 * 通道二：Scheme URL（lxmusic://）
 *   - 搜索并播放：lxmusic://music/searchPlay?data=<URL编码JSON>
 *     用 data 传参而不是路径传参，是为了避开客户端把歌名里第一个 "-" 当作
 *     “歌名-歌手” 分隔符的解析（路径传参下 "Love-Story" 会被拆坏）。
 *
 * 已知边界（源码核实，v2.12.6）：
 *   - 不存在 /play-mode、/play-list、/play-index、/like、/unlike、/dislike，未知路径返回 401 Forbidden
 *   - /status 的 volume 为 0-100 整数，/volume 也接收 0-100
 *   - 状态值包含拼写为 'stoped' 的停止态
 *   - /seek?offset= 超过 duration 会返回 400
 */

;(function () {
  'use strict'

  // 只运行在顶层窗口（双保险：@noframes）
  if (window.top !== window.self) return

  /* ============================================================
   * 常量
   * ============================================================ */
  const API_HOST = '127.0.0.1'
  const DEFAULT_PORT = 23330
  const FIELDS = [
    'status', 'name', 'singer', 'albumName', 'picUrl',
    'progress', 'duration', 'playbackRate',
    'lyricLineText', 'lyricLineAllText',
    'collect', 'volume', 'mute',
  ]
  const FILTER = FIELDS.join(',')

  // 轮询间隔（毫秒）：连接正常且有 SSE 时只做低频兜底
  const POLL = {
    retry: 3000,     // 未连接：自动重试
    fast: 1000,      // 面板打开
    normal: 2000,    // 播放中
    idle: 4000,      // 空闲
    hidden: 5000,    // 页面不可见
    watchdog: 15000, // SSE 健康时的兜底同步
  }

  // 乐观更新的保持时间（毫秒）：本地操作后，短暂忽略服务端回包，避免控件“跳回去”
  const HOLD = { status: 1200, progress: 1000, volume: 900, mute: 900, collect: 900 }

  const BALL_SIZE = 48

  /* ============================================================
   * 工具
   * ============================================================ */
  const clamp = (v, min, max) => (v < min ? min : v > max ? max : v)
  const round1 = v => Math.round(v * 10) / 10

  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0
    const total = Math.floor(sec)
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total % 60
    const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
    return (h > 0 ? h + ':' + mm : mm) + ':' + String(s).padStart(2, '0')
  }

  function icon(path, size) {
    size = size || 20
    return '<svg class="ico" viewBox="0 0 24 24" width="' + size + '" height="' + size +
      '" fill="currentColor" aria-hidden="true"><path d="' + path + '"/></svg>'
  }

  const ICON = {
    note: 'M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z',
    play: 'M8 5v14l11-7z',
    pause: 'M6 5h4v14H6zM14 5h4v14h-4z',
    prev: 'M6 6h2v12H6zM20 6l-10 6 10 6z',
    next: 'M18 6h-2v12h2zM4 6l10 6-10 6z',
    heart: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
    heartOutline: 'M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z',
    vol: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z',
    mute: 'M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z',
    search: 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
    gear: 'M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87a.48.48 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58zM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z',
    refresh: 'M17.65 6.35A8 8 0 1 0 19.73 14h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
    warn: 'M12 2 1 21h22L12 2zm1 16h-2v-2h2v2zm0-4h-2v-4h2v4z',
  }

  /* ============================================================
   * 设置存储（GM4 → GM3 → localStorage 逐级降级）
   * ============================================================ */
  const store = {
    async get(key, def) {
      try {
        if (typeof GM_getValue === 'function') return GM_getValue(key, def)
        if (typeof GM !== 'undefined' && GM && typeof GM.getValue === 'function') {
          const v = await GM.getValue(key, def)
          return v === undefined ? def : v
        }
        const raw = window.localStorage ? localStorage.getItem('lxmes:' + key) : null
        return raw == null ? def : JSON.parse(raw)
      } catch (e) {
        return def
      }
    },
    async set(key, val) {
      try {
        if (typeof GM_setValue === 'function') {
          GM_setValue(key, val)
          return
        }
        if (typeof GM !== 'undefined' && GM && typeof GM.setValue === 'function') {
          await GM.setValue(key, val)
          return
        }
        if (window.localStorage) localStorage.setItem('lxmes:' + key, JSON.stringify(val))
      } catch (e) { /* 忽略存储失败 */ }
    },
  }

  /* ============================================================
   * 网络（全部走 GM_xmlhttpRequest，绕开页面 CORS / CSP / 混合内容）
   * ============================================================ */
  function gmRequest(url, timeout) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({
          method: 'GET',
          url,
          timeout,
          onload: res => resolve({ status: res.status, text: res.responseText || '' }),
          onerror: () => reject(new Error('network')),
          ontimeout: () => reject(new Error('timeout')),
          onabort: () => reject(new Error('abort')),
        })
        return
      }
      if (typeof GM !== 'undefined' && GM && typeof GM.xmlHttpRequest === 'function') {
        GM.xmlHttpRequest({ method: 'GET', url, timeout }).then(
          res => resolve({ status: res.status, text: res.responseText || '' }),
          () => reject(new Error('network'))
        )
        return
      }
      // 兜底：脚本管理器未提供 GM_xmlhttpRequest 时用页面 fetch
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), timeout)
      fetch(url, { signal: ctrl.signal }).then(
        r => r.text().then(t => {
          clearTimeout(timer)
          resolve({ status: r.status, text: t })
        }),
        () => {
          clearTimeout(timer)
          reject(new Error('network'))
        }
      )
    })
  }

  async function apiGet(path, timeout) {
    const res = await gmRequest(state.base + path, timeout || 3500)
    if (res.status === 200) return res.text
    const err = new Error((res.text || '').trim() || ('HTTP ' + res.status))
    err.httpStatus = res.status
    throw err
  }

  /* ============================================================
   * 运行状态
   * ============================================================ */
  const state = {
    port: DEFAULT_PORT,
    base: 'http://' + API_HOST + ':' + DEFAULT_PORT,
    connected: false,
    everConnected: false,
    offlineSince: 0,
    status: {
      status: 'stoped',
      name: '',
      singer: '',
      albumName: '',
      picUrl: '',
      progress: 0,
      duration: 0,
      playbackRate: 1,
      lyricLineText: '',
      lyricLineAllText: '',
      collect: false,
      volume: 0,
      mute: false,
    },
    syncAt: performance.now(), // progress 同步时刻，用于本地插值
    sseAlive: false,
    panelOpen: false,
  }

  // 乐观更新保持窗口
  const holds = {}
  function hold(key, ms) {
    holds[key] = Date.now() + ms
    // 保持窗口结束后主动同步一次，防止乐观值残留
    setTimeout(() => { if (!ballHidden) schedulePoll(0) }, ms + 250)
  }
  const isHeld = key => (holds[key] || 0) > Date.now()

  // 进度条拖动中的临时值
  let progDrag = null
  let volDrag = null

  /* ============================================================
   * SSE 实时通道
   * ============================================================ */
  const sse = { enabled: true, es: null, alive: false, errors: 0 }

  function startSSE() {
    if (!sse.enabled || sse.es) return
    if (typeof window.EventSource !== 'function') {
      sse.enabled = false
      return
    }
    let es
    try {
      es = new EventSource(state.base + '/subscribe-player-status?filter=' + FILTER)
    } catch (e) {
      sse.enabled = false
      return
    }
    sse.es = es
    es.onopen = () => {
      sse.alive = true
      sse.errors = 0
      state.sseAlive = true
    }
    FIELDS.forEach(key => {
      es.addEventListener(key, ev => {
        let val
        try { val = JSON.parse(ev.data) } catch (e) { val = ev.data }
        applyStatus({ [key]: val })
      })
    })
    es.onerror = () => {
      sse.alive = false
      state.sseAlive = false
      // 立刻核实一次连接：SSE 断开（客户端退出、端口被占）时，UI 不必等兜底轮询才发现
      schedulePoll(600)
      if (es.readyState === 2 /* CLOSED：无法建立或被拒绝，不再自动重连 */) {
        stopSSE(true)
      } else {
        // CONNECTING：浏览器会自动重连，连续失败多次则放弃
        sse.errors += 1
        if (sse.errors >= 4) stopSSE(true)
      }
    }
  }

  function stopSSE(disable) {
    if (sse.es) {
      try { sse.es.close() } catch (e) { /* 忽略 */ }
      sse.es = null
    }
    sse.alive = false
    state.sseAlive = false
    if (disable) sse.enabled = false
  }

  /* ============================================================
   * 状态同步
   * ============================================================ */
  function applyStatus(patch) {
    const st = state.status
    let changed = false
    for (const key in patch) {
      if (!(key in st)) continue
      if (isHeld(key)) continue
      if (st[key] !== patch[key]) {
        st[key] = patch[key]
        changed = true
      }
    }
    if (patch.progress !== undefined || patch.duration !== undefined) {
      state.syncAt = performance.now()
    }
    if (changed) render()
  }

  async function fetchStatus() {
    try {
      const text = await apiGet('/status?filter=' + FILTER, 3500)
      const data = JSON.parse(text)
      setConnected(true)
      applyStatus(data)
    } catch (e) {
      setConnected(false)
    }
  }

  function setConnected(ok) {
    const wasConnected = state.connected
    state.connected = ok
    if (ok) {
      state.offlineSince = 0
      if (!wasConnected) {
        state.everConnected = true
        render()
        // 连接恢复后，给 SSE 一次新的机会
        if (!sse.enabled) {
          sse.enabled = true
          sse.errors = 0
        }
        startSSE()
      }
    } else {
      if (!state.offlineSince) state.offlineSince = Date.now()
      state.sseAlive = false
      stopSSE(false)
      if (wasConnected) render()
    }
  }

  /* 轮询循环 */
  let pollTimer = null

  function nextPollDelay() {
    if (!state.connected) return POLL.retry
    if (sse.alive) return POLL.watchdog
    if (document.hidden) return POLL.hidden
    if (state.panelOpen) return POLL.fast
    if (state.status.status === 'playing') return POLL.normal
    return POLL.idle
  }

  function schedulePoll(delay) {
    clearTimeout(pollTimer)
    const d = delay == null ? nextPollDelay() : Math.max(0, delay)
    pollTimer = setTimeout(async () => {
      await fetchStatus()
      schedulePoll()
    }, d)
  }

  /* 控制指令后尽快刷新（例如切歌后） */
  function refreshSoon(delay) {
    schedulePoll(delay == null ? 350 : delay)
  }

  async function cmd(path, label) {
    try {
      await apiGet(path, 3000)
      refreshSoon()
      return true
    } catch (e) {
      if (e.httpStatus) {
        showToast(label + '失败：' + e.message, 'err')
      } else {
        setConnected(false)
        showToast('无法连接 LX Music', 'err', '请确认桌面端已启动、开放 API 已启用（默认端口 23330）')
      }
      return false
    }
  }

  /* ============================================================
   * Scheme URL（搜索通道）
   * ============================================================ */
  function openScheme(url) {
    try {
      const a = document.createElement('a')
      a.href = url
      a.style.display = 'none'
      document.documentElement.appendChild(a)
      a.click()
      setTimeout(() => a.remove(), 1000)
    } catch (e) {
      showToast('无法唤起 LX Music', 'err', '请确认已安装桌面版并能正确处理 lxmusic:// 链接')
    }
  }

  function doSearch() {
    const raw = els.input.value.trim()
    if (!raw) return
    let name = raw
    let singer = ''
    // 只按 “ - ”（两侧带空格）拆分，避免误伤歌名自带的连字符
    const m = raw.match(/^(.+?)\s+-\s+(.+)$/)
    if (m) {
      name = m[1].trim()
      singer = m[2].trim()
    }
    if (name.length > 200) name = name.slice(0, 200)
    if (singer.length > 200) singer = singer.slice(0, 200)
    const data = { name }
    if (singer) data.singer = singer
    openScheme('lxmusic://music/searchPlay?data=' + encodeURIComponent(JSON.stringify(data)))
    els.input.value = ''
    showToast('已请求搜索并播放：' + raw, 'ok', '若 LX Music 没有反应，请确认已安装桌面版，并允许浏览器打开外部程序')
  }

  /* ============================================================
   * UI
   * ============================================================ */
  const host = document.createElement('div')
  host.id = 'lx-music-easy-script'
  const shadow = host.attachShadow({ mode: 'closed' })

  const CSS = `
:host { all: initial; }
* { box-sizing: border-box; margin: 0; padding: 0; }
.ui {
  --c: #4daf7c; --c-light: #6fd39c; --c-deep: #3f9e6f;
  --danger: #e5484d;
  --txt: #eef2f5;
  --dim: rgba(238,242,245,.6);
  --faint: rgba(238,242,245,.36);
  --line: rgba(255,255,255,.09);
  position: fixed; z-index: 2147483647; left: 0; top: 0; width: 0; height: 0;
  font-family: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  font-size: 13px; line-height: 1.5; color: var(--txt);
  -webkit-font-smoothing: antialiased;
}
.ui, .ui * { box-sizing: border-box; }
/* 宿主不拦截页面交互：只有球与面板自身可点（pointer-events 可继承，子元素随之恢复） */
.ui { pointer-events: none; }
.ui .pe { pointer-events: auto; }

/* ---------- 悬浮球 ---------- */
.ball {
  position: fixed; width: ${BALL_SIZE}px; height: ${BALL_SIZE}px; border-radius: 50%;
  border: 0; padding: 0; cursor: pointer; user-select: none; touch-action: none;
  display: grid; place-items: center; color: #fff; outline: none;
  background: radial-gradient(120% 120% at 30% 22%, #7fdea9 0%, var(--c) 52%, var(--c-deep) 100%);
  box-shadow: 0 8px 20px -6px rgba(0,0,0,.45), 0 2px 6px rgba(0,0,0,.25), inset 0 1px 0 rgba(255,255,255,.35);
  transition: transform .18s cubic-bezier(.34,1.56,.64,1), filter .3s, opacity .2s;
  -webkit-tap-highlight-color: transparent;
}
.ball:hover { transform: scale(1.07); }
.ball:active { transform: scale(.95); }
.ball.dragging { transition: none; cursor: grabbing; transform: scale(1.05); }
.ball.offline { background: radial-gradient(120% 120% at 30% 22%, #9aa4ac 0%, #6b767e 52%, #57626a 100%); }
.ball.playing::before {
  content: ""; position: absolute; inset: -7px; border-radius: 50%; pointer-events: none;
  background: radial-gradient(circle, rgba(77,175,124,.42), rgba(77,175,124,0) 70%);
  animation: lxePulse 2.2s ease-in-out infinite;
}
@keyframes lxePulse {
  0%, 100% { opacity: .3; transform: scale(.95); }
  50% { opacity: .85; transform: scale(1.06); }
}
.ball .ring { position: absolute; inset: 0; width: 100%; height: 100%; transform: rotate(-90deg); }
.ball .ring circle { fill: none; stroke-width: 2.5; }
.ball .ring .track { stroke: rgba(255,255,255,.25); }
.ball .ring .bar { stroke: #fff; stroke-linecap: round; transition: stroke-dashoffset .35s linear; }
.ball.offline .ring { display: none; }
.ball .badge {
  position: absolute; top: -2px; right: -2px; width: 13px; height: 13px; border-radius: 50%;
  background: var(--danger); border: 2px solid rgba(20,24,26,.9); display: none;
}
.ball.offline .badge { display: block; }
.ball .ico, .ball .ring { pointer-events: none; }

/* ---------- 面板 ---------- */
.panel {
  position: fixed; width: 304px; max-width: calc(100vw - 24px); padding: 12px 12px 10px;
  border-radius: 16px; border: 1px solid rgba(255,255,255,.08);
  background: linear-gradient(165deg, rgba(34,40,45,.88), rgba(20,24,28,.9));
  -webkit-backdrop-filter: blur(20px) saturate(140%); backdrop-filter: blur(20px) saturate(140%);
  box-shadow: 0 24px 48px -16px rgba(0,0,0,.6), 0 4px 14px rgba(0,0,0,.3), inset 0 1px 0 rgba(255,255,255,.06);
  animation: lxePop .16s ease-out;
}
@keyframes lxePop {
  from { opacity: 0; transform: scale(.95) translateY(-4px); }
  to { opacity: 1; transform: none; }
}
.head { display: flex; align-items: center; gap: 10px; }
.cover {
  width: 40px; height: 40px; border-radius: 10px; overflow: hidden; flex: 0 0 auto;
  background: rgba(255,255,255,.07); border: 1px solid var(--line);
  display: grid; place-items: center; color: var(--faint);
}
.cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
.meta { flex: 1; min-width: 0; }
.meta .t { font-size: 13.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.meta .s { font-size: 11.5px; color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
.dot {
  width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto;
  background: var(--c); box-shadow: 0 0 0 3px rgba(77,175,124,.16);
}
.dot.off { background: var(--danger); box-shadow: 0 0 0 3px rgba(229,72,77,.16); }

.lyric { margin: 10px 0 2px; min-height: 34px; text-align: center; }
.lyric .l1 { font-size: 12.5px; color: rgba(238,242,245,.92); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lyric .l2 { font-size: 11px; color: var(--dim); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lyric.empty .l1 { color: var(--faint); }

.prow { display: flex; align-items: center; gap: 8px; margin-top: 6px; font-size: 10.5px; color: var(--dim); font-variant-numeric: tabular-nums; }
.prow .time { flex: 0 0 auto; min-width: 34px; text-align: center; }
.bar {
  position: relative; flex: 1; height: 18px; touch-action: none; cursor: pointer;
  display: flex; align-items: center;
}
.bar::before { content: ""; position: absolute; left: 0; right: 0; height: 4px; border-radius: 3px; background: rgba(255,255,255,.14); }
.bar .fill { position: absolute; left: 0; height: 4px; border-radius: 3px; background: linear-gradient(90deg, var(--c-deep), var(--c-light)); transition: width .25s linear; }
.bar .knob {
  position: absolute; width: 10px; height: 10px; border-radius: 50%; background: #fff;
  box-shadow: 0 1px 4px rgba(0,0,0,.45); transform: translateX(-50%); transition: left .25s linear, transform .12s;
}
.bar:hover .knob { transform: translateX(-50%) scale(1.15); }
.bar.dragging .fill, .bar.dragging .knob { transition: none; }
.bar.dragging .knob { transform: translateX(-50%) scale(1.25); }
.bar.disabled { cursor: default; opacity: .55; }

.ctrl { display: flex; align-items: center; justify-content: center; gap: 6px; margin-top: 4px; }
.btn {
  appearance: none; border: 0; background: transparent; color: var(--txt);
  width: 36px; height: 36px; border-radius: 10px; padding: 0;
  display: grid; place-items: center; cursor: pointer; outline: none;
  transition: background .15s, color .15s, transform .1s;
  font-family: inherit; -webkit-tap-highlight-color: transparent;
}
.btn:hover { background: rgba(255,255,255,.08); }
.btn:active { transform: scale(.94); }
.btn[disabled] { opacity: .28; pointer-events: none; }
.btn.on { color: var(--c-light); }
.btn.main {
  width: 46px; height: 46px; border-radius: 50%; color: #fff;
  background: linear-gradient(160deg, var(--c-light), var(--c-deep));
  box-shadow: 0 6px 16px -6px rgba(77,175,124,.75);
}
.btn.main:hover { filter: brightness(1.07); background: linear-gradient(160deg, var(--c-light), var(--c-deep)); }

.vrow { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
.vrow .vnum { flex: 0 0 auto; min-width: 26px; text-align: right; font-size: 10.5px; color: var(--dim); font-variant-numeric: tabular-nums; }
.vbar { height: 16px; }
.vbar::before, .vbar .fill { height: 3px; }
.vbar .knob { width: 9px; height: 9px; }

.search {
  display: flex; align-items: center; gap: 4px; margin-top: 10px; height: 34px;
  padding: 0 4px 0 10px; border-radius: 10px; border: 1px solid var(--line);
  background: rgba(255,255,255,.06); transition: border-color .15s, box-shadow .15s;
}
.search:focus-within { border-color: rgba(77,175,124,.55); box-shadow: 0 0 0 3px rgba(77,175,124,.14); }
.search input {
  flex: 1; min-width: 0; height: 100%; border: 0; outline: none; background: transparent;
  color: var(--txt); font-size: 12px; font-family: inherit;
}
.search input::placeholder { color: var(--faint); }
.search .go { width: 28px; height: 28px; border-radius: 8px; border: 0; background: transparent; color: var(--dim); cursor: pointer; display: grid; place-items: center; padding: 0; }
.search .go:hover { background: rgba(255,255,255,.1); color: var(--txt); }

.foot {
  display: flex; align-items: center; gap: 4px; margin-top: 9px; padding-top: 8px;
  border-top: 1px solid var(--line); font-size: 10.5px; color: var(--faint);
}
.foot .addr { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.linkbtn {
  border: 0; background: transparent; color: var(--dim); cursor: pointer; font-size: 10.5px;
  padding: 3px 7px; border-radius: 6px; font-family: inherit;
}
.linkbtn:hover { background: rgba(255,255,255,.08); color: var(--txt); }

.offline { margin-top: 10px; padding: 11px 12px; border-radius: 12px; border: 1px solid var(--line); background: rgba(255,255,255,.045); }
.offline .hd { display: flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; }
.offline .hd svg { color: var(--danger); }
.offline ol { margin: 7px 0 9px 16px; font-size: 11.5px; color: var(--dim); line-height: 1.75; }
.offline .retry {
  width: 100%; height: 30px; border-radius: 8px; cursor: pointer; font-size: 12px; font-family: inherit;
  border: 1px solid rgba(77,175,124,.5); background: rgba(77,175,124,.12); color: #a9e8c4;
}
.offline .retry:hover { background: rgba(77,175,124,.2); }
.offline .hint { margin-top: 8px; font-size: 10.5px; color: var(--faint); line-height: 1.6; }

.settings { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
.settings label { font-size: 11px; color: var(--dim); white-space: nowrap; }
.settings input {
  width: 76px; height: 28px; padding: 0 8px; border-radius: 8px; outline: none;
  border: 1px solid var(--line); background: rgba(0,0,0,.25); color: var(--txt);
  font-size: 12px; font-family: inherit;
}
.settings button {
  height: 28px; padding: 0 10px; border-radius: 8px; cursor: pointer; font-size: 11.5px; font-family: inherit;
  border: 1px solid var(--line); background: rgba(255,255,255,.06); color: var(--txt);
}
.settings button:hover { background: rgba(255,255,255,.12); }

.toast {
  position: fixed; left: 50%; bottom: 24px; transform: translate(-50%, 12px);
  max-width: min(420px, calc(100vw - 32px)); padding: 9px 14px; border-radius: 12px;
  background: rgba(23,27,31,.93); border: 1px solid var(--line); color: var(--txt);
  -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px);
  box-shadow: 0 12px 30px -10px rgba(0,0,0,.6);
  font-size: 12.5px; opacity: 0; transition: opacity .18s, transform .18s;
  z-index: 2147483647;
}
.toast.show { opacity: 1; transform: translate(-50%, 0); }
.toast.err { border-color: rgba(229,72,77,.45); }
.toast .sub { margin-top: 3px; font-size: 11px; color: var(--dim); }

@media (prefers-reduced-motion: reduce) {
  .ball.playing::before, .panel { animation: none; }
  .bar .fill, .bar .knob, .ball { transition: none; }
}
`

  shadow.innerHTML = `
<style>${CSS}</style>
<div class="ui">
  <button class="ball pe" type="button" aria-label="LX Music 遥控器">
    <svg class="ring" viewBox="0 0 48 48" aria-hidden="true">
      <circle class="track" cx="24" cy="24" r="21.5"></circle>
      <circle class="bar" cx="24" cy="24" r="21.5"></circle>
    </svg>
    ${icon(ICON.note, 22)}
    <span class="badge"></span>
  </button>

  <section class="panel pe" role="dialog" aria-label="LX Music 遥控器" hidden>
    <div class="head">
      <div class="cover">
        <img class="cover-img" alt="" referrerpolicy="no-referrer" style="display:none">
        ${icon(ICON.note, 18)}
      </div>
      <div class="meta">
        <div class="t title">暂无播放</div>
        <div class="s sub">在浏览器里遥控 LX Music</div>
      </div>
      <i class="dot"></i>
    </div>

    <div class="lyric empty">
      <div class="l1">♪</div>
      <div class="l2" hidden></div>
    </div>

    <div class="prow">
      <span class="time t-cur">00:00</span>
      <div class="bar pbar" data-role="progress"><i class="fill"></i><i class="knob"></i></div>
      <span class="time t-total">00:00</span>
    </div>

    <div class="ctrl">
      <button class="btn" type="button" data-act="prev" aria-label="上一首">${icon(ICON.prev)}</button>
      <button class="btn main" type="button" data-act="toggle" aria-label="播放 / 暂停">${icon(ICON.play, 24)}</button>
      <button class="btn" type="button" data-act="next" aria-label="下一首">${icon(ICON.next)}</button>
      <button class="btn collect" type="button" data-act="collect" aria-label="收藏">${icon(ICON.heartOutline)}</button>
    </div>

    <div class="vrow">
      <button class="btn mute" type="button" data-act="mute" aria-label="静音" style="width:30px;height:30px">${icon(ICON.vol, 18)}</button>
      <div class="bar vbar" data-role="volume"><i class="fill"></i><i class="knob"></i></div>
      <span class="vnum">0</span>
    </div>

    <div class="offline" hidden>
      <div class="hd">${icon(ICON.warn, 15)}未连接到 LX Music</div>
      <ol>
        <li>打开 LX Music 桌面版（v2.7.0 及以上）</li>
        <li>设置 → 开放 API → 启用</li>
        <li>确认端口与脚本一致（默认 23330）</li>
      </ol>
      <button class="retry" type="button" data-act="retry">重试连接</button>
      <div class="hint">会自动重试。搜索功能不受影响，仍可通过 lxmusic:// 唤起客户端。</div>
    </div>

    <div class="search">
      <input class="q" type="text" placeholder="搜索并播放：歌名 或 歌名 - 歌手" aria-label="搜索并播放">
      <button class="go" type="button" data-act="search" aria-label="搜索并播放">${icon(ICON.search, 17)}</button>
    </div>

    <div class="foot">
      <span class="addr">未连接</span>
      <button class="linkbtn" type="button" data-act="retry">重试</button>
      <button class="linkbtn" type="button" data-act="settings" aria-label="设置">${icon(ICON.gear, 13)}</button>
    </div>

    <div class="settings" hidden>
      <label>开放 API 端口</label>
      <input class="port" type="text" inputmode="numeric" placeholder="23330">
      <button type="button" data-act="save-port">保存并重连</button>
    </div>
  </section>

  <div class="toast" role="status"></div>
</div>
`

  const $ = sel => shadow.querySelector(sel)
  const els = {
    ui: $('.ui'),
    ball: $('.ball'),
    ringBar: $('.ring .bar'),
    panel: $('.panel'),
    cover: $('.cover'),
    coverImg: $('.cover-img'),
    title: $('.meta .t'),
    sub: $('.meta .s'),
    dot: $('.dot'),
    lyric: $('.lyric'),
    lyric1: $('.lyric .l1'),
    lyric2: $('.lyric .l2'),
    pbar: $('.pbar'),
    tCur: $('.t-cur'),
    tTotal: $('.t-total'),
    toggleBtn: $('[data-act="toggle"]'),
    collectBtn: $('.collect'),
    muteBtn: $('.mute'),
    vbar: $('.vbar'),
    vnum: $('.vnum'),
    offline: $('.offline'),
    addr: $('.addr'),
    settings: $('.settings'),
    port: $('.settings .port'),
    input: $('.search .q'),
    toast: $('.toast'),
  }

  const RING_LEN = 2 * Math.PI * 21.5
  els.ringBar.style.strokeDasharray = String(RING_LEN)
  els.ringBar.style.strokeDashoffset = String(RING_LEN)

  /* ---------- 球的位置与拖拽 ---------- */
  const ballPos = { x: 0, y: 0 }
  let posLoaded = false

  function applyBallPos() {
    els.ball.style.left = Math.round(ballPos.x) + 'px'
    els.ball.style.top = Math.round(ballPos.y) + 'px'
  }

  function clampBallPos() {
    const vw = window.innerWidth
    const vh = window.innerHeight
    ballPos.x = clamp(ballPos.x, 6, Math.max(6, vw - BALL_SIZE - 6))
    ballPos.y = clamp(ballPos.y, 6, Math.max(6, vh - BALL_SIZE - 6))
  }

  function snapBallPos() {
    const vw = window.innerWidth
    const margin = 12
    if (ballPos.x < 70) ballPos.x = margin
    else if (ballPos.x + BALL_SIZE > vw - 70) ballPos.x = vw - margin - BALL_SIZE
    clampBallPos()
    store.set('pos', { x: Math.round(ballPos.x), y: Math.round(ballPos.y) })
  }

  function dragStart(e) {
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    const originX = ballPos.x
    const originY = ballPos.y
    let moved = false
    els.ball.setPointerCapture(e.pointerId)

    const onMove = ev => {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      if (!moved && Math.abs(dx) + Math.abs(dy) > 4) {
        moved = true
        els.ball.classList.add('dragging')
      }
      if (!moved) return
      ballPos.x = originX + dx
      ballPos.y = originY + dy
      clampBallPos()
      applyBallPos()
      if (state.panelOpen) positionPanel()
    }
    const onUp = () => {
      els.ball.removeEventListener('pointermove', onMove)
      els.ball.removeEventListener('pointerup', onUp)
      els.ball.removeEventListener('pointercancel', onUp)
      els.ball.classList.remove('dragging')
      if (moved) snapBallPos()
      else togglePanel()
      applyBallPos()
      if (state.panelOpen) positionPanel()
    }
    els.ball.addEventListener('pointermove', onMove)
    els.ball.addEventListener('pointerup', onUp)
    els.ball.addEventListener('pointercancel', onUp)
  }

  els.ball.addEventListener('pointerdown', dragStart)

  /* ---------- 面板定位 ---------- */
  function positionPanel() {
    const gap = 10
    const vw = window.innerWidth
    const vh = window.innerHeight
    const pw = els.panel.offsetWidth || 304
    const ph = els.panel.offsetHeight || 300
    let x
    if (ballPos.x + BALL_SIZE / 2 > vw / 2) x = ballPos.x - pw - gap
    else x = ballPos.x + BALL_SIZE + gap
    x = clamp(x, 8, Math.max(8, vw - pw - 8))
    const y = clamp(ballPos.y - 6, 8, Math.max(8, vh - ph - 8))
    els.panel.style.left = Math.round(x) + 'px'
    els.panel.style.top = Math.round(y) + 'px'
  }

  function openPanel() {
    state.panelOpen = true
    els.panel.hidden = false
    render()
    positionPanel()
    schedulePoll(POLL.fast)
  }

  function closePanel() {
    state.panelOpen = false
    els.panel.hidden = true
    schedulePoll()
  }

  function togglePanel() {
    if (state.panelOpen) closePanel()
    else openPanel()
  }

  /* ---------- 渲染 ---------- */
  const cache = {}

  function setText(el, text, key) {
    if (cache[key] === text) return
    cache[key] = text
    el.textContent = text
  }

  function renderConn() {
    const ok = state.connected
    els.ball.classList.toggle('offline', !ok)
    els.dot.classList.toggle('off', !ok)
    els.offline.hidden = ok
    setText(els.addr, ok ? ('已连接 ' + API_HOST + ':' + state.port) : '未连接 · ' + API_HOST + ':' + state.port, 'addr')
    els.ui.classList.toggle('connected', ok)
  }

  function renderCover() {
    const url = state.connected ? (state.status.picUrl || '') : ''
    if (cache.coverUrl === url) return
    cache.coverUrl = url
    if (url) {
      els.coverImg.style.display = ''
      els.coverImg.src = url
      els.cover.querySelector('svg').style.display = 'none'
    } else {
      els.coverImg.style.display = 'none'
      els.coverImg.removeAttribute('src')
      els.cover.querySelector('svg').style.display = ''
    }
  }

  function renderSong() {
    const st = state.status
    const has = state.connected && !!st.name
    setText(els.title, has ? st.name : (state.connected ? '暂无播放' : '未连接到 LX Music'), 'title')
    const sub = has ? [st.singer, st.albumName].filter(Boolean).join(' · ') : (state.connected ? '在浏览器里遥控 LX Music' : '')
    setText(els.sub, sub, 'sub')

    const line = has ? (st.lyricLineText || '') : ''
    const all = has ? (st.lyricLineAllText || '') : ''
    const sub2 = all.split('\n').slice(1).join(' / ').trim()
    els.lyric.classList.toggle('empty', !line)
    setText(els.lyric1, line || (has ? '♪' : '♪'), 'l1')
    els.lyric2.hidden = !sub2
    if (sub2) setText(els.lyric2, sub2, 'l2')

    els.collectBtn.disabled = !has
    els.collectBtn.classList.toggle('on', !!st.collect)
    const hk = st.collect ? 'heart' : 'heartOutline'
    if (cache.collectIcon !== hk) {
      cache.collectIcon = hk
      els.collectBtn.innerHTML = icon(st.collect ? ICON.heart : ICON.heartOutline)
    }
  }

  function renderPlayBtn() {
    const playing = state.status.status === 'playing'
    const key = playing ? 'pause' : 'play'
    if (cache.playIcon === key) return
    cache.playIcon = key
    els.toggleBtn.innerHTML = icon(playing ? ICON.pause : ICON.play, 24)
    els.toggleBtn.setAttribute('aria-label', playing ? '暂停' : '播放')
  }

  function renderProgress(sec) {
    const st = state.status
    const dur = st.duration || 0
    const p = clamp(sec == null ? st.progress : sec, 0, dur || 0)
    const ratio = dur > 0 ? p / dur : 0
    const pct = (ratio * 100).toFixed(2) + '%'
    if (cache.pct !== pct) {
      cache.pct = pct
      els.pbar.querySelector('.fill').style.width = pct
      els.pbar.querySelector('.knob').style.left = pct
      els.ringBar.style.strokeDashoffset = String(RING_LEN * (1 - ratio))
    }
    setText(els.tCur, fmtTime(p), 'tcur')
    setText(els.tTotal, fmtTime(dur), 'ttot')
    els.pbar.classList.toggle('disabled', !dur)
  }

  function renderVolume() {
    const st = state.status
    const v = clamp(st.volume || 0, 0, 100)
    const pct = v + '%'
    if (cache.vpct !== pct) {
      cache.vpct = pct
      els.vbar.querySelector('.fill').style.width = pct
      els.vbar.querySelector('.knob').style.left = pct
    }
    setText(els.vnum, String(v), 'vnum')
    const key = st.mute ? 'mute' : 'vol'
    if (cache.muteIcon !== key) {
      cache.muteIcon = key
      els.muteBtn.innerHTML = icon(st.mute ? ICON.mute : ICON.vol, 18)
      els.muteBtn.classList.toggle('on', !!st.mute)
    }
  }

  function renderBall() {
    const playing = state.connected && state.status.status === 'playing'
    els.ball.classList.toggle('playing', playing)
    let title = 'LX Music'
    if (!state.connected) title = '未连接到 LX Music'
    else if (state.status.name) title = state.status.name + (state.status.singer ? ' - ' + state.status.singer : '')
    if (cache.ballTitle !== title) {
      cache.ballTitle = title
      els.ball.title = title
    }
  }

  function render() {
    renderConn()
    renderCover()
    renderSong()
    renderPlayBtn()
    renderVolume()
    const st = state.status
    let p = st.progress || 0
    if (state.connected && st.status === 'playing' && !progDrag && !isHeld('progress')) {
      p += ((performance.now() - state.syncAt) / 1000) * (st.playbackRate || 1)
    }
    renderProgress(p)
    renderBall()
  }

  /* 播放中：本地插值让进度与时间平滑推进（SSE 4Hz / 轮询 1s 都不卡顿） */
  setInterval(() => {
    if (!state.connected || progDrag) return
    const st = state.status
    if (st.status !== 'playing' || !st.duration) return
    if (isHeld('progress')) return
    const p = clamp(st.progress + ((performance.now() - state.syncAt) / 1000) * (st.playbackRate || 1), 0, st.duration)
    renderProgress(p)
  }, 500)

  /* ---------- 进度条拖动 ---------- */
  function barRatio(bar, clientX) {
    const r = bar.getBoundingClientRect()
    return clamp((clientX - r.left) / (r.width || 1), 0, 1)
  }

  els.pbar.addEventListener('pointerdown', e => {
    if (!state.connected || !state.status.duration) return
    e.preventDefault()
    progDrag = { value: state.status.progress }
    els.pbar.classList.add('dragging')
    els.pbar.setPointerCapture(e.pointerId)
    progDrag.value = barRatio(els.pbar, e.clientX) * state.status.duration
    renderProgress(progDrag.value)
  })
  els.pbar.addEventListener('pointermove', e => {
    if (!progDrag) return
    progDrag.value = barRatio(els.pbar, e.clientX) * state.status.duration
    renderProgress(progDrag.value)
  })
  const endProgDrag = commit => {
    if (!progDrag) return
    const value = progDrag.value
    progDrag = null
    els.pbar.classList.remove('dragging')
    if (!commit) {
      render()
      return
    }
    const secs = clamp(Math.round(value), 0, Math.floor(state.status.duration || 0))
    hold('progress', HOLD.progress)
    state.status.progress = secs
    state.syncAt = performance.now()
    renderProgress(secs)
    apiGet('/seek?offset=' + secs, 3000).then(() => refreshSoon(400)).catch(e => {
      if (!e.httpStatus) setConnected(false)
      render()
    })
  }
  els.pbar.addEventListener('pointerup', () => endProgDrag(true))
  els.pbar.addEventListener('pointercancel', () => endProgDrag(false))

  /* ---------- 音量拖动 ---------- */
  els.vbar.addEventListener('pointerdown', e => {
    if (!state.connected) return
    e.preventDefault()
    volDrag = { value: state.status.volume || 0 }
    els.vbar.classList.add('dragging')
    els.vbar.setPointerCapture(e.pointerId)
    volDrag.value = Math.round(barRatio(els.vbar, e.clientX) * 100)
    renderVolumePreview(volDrag.value)
  })
  els.vbar.addEventListener('pointermove', e => {
    if (!volDrag) return
    volDrag.value = Math.round(barRatio(els.vbar, e.clientX) * 100)
    renderVolumePreview(volDrag.value)
  })
  function renderVolumePreview(v) {
    const pct = clamp(v, 0, 100) + '%'
    els.vbar.querySelector('.fill').style.width = pct
    els.vbar.querySelector('.knob').style.left = pct
    setText(els.vnum, String(clamp(v, 0, 100)), 'vnum')
  }
  const endVolDrag = commit => {
    if (!volDrag) return
    const value = volDrag.value
    volDrag = null
    els.vbar.classList.remove('dragging')
    if (!commit) {
      renderVolume()
      return
    }
    hold('volume', HOLD.volume)
    state.status.volume = value
    apiGet('/volume?volume=' + value, 3000).then(() => refreshSoon(500)).catch(e => {
      if (!e.httpStatus) setConnected(false)
      renderVolume()
    })
  }
  els.vbar.addEventListener('pointerup', () => endVolDrag(true))
  els.vbar.addEventListener('pointercancel', () => endVolDrag(false))

  /* ---------- 按钮 ---------- */
  shadow.addEventListener('click', e => {
    const target = e.target && e.target.closest ? e.target.closest('[data-act]') : null
    if (!target) return
    const act = target.getAttribute('data-act')
    switch (act) {
      case 'toggle': {
        if (!state.connected) return
        const playing = state.status.status === 'playing'
        hold('status', HOLD.status)
        state.status.status = playing ? 'paused' : 'playing'
        renderPlayBtn()
        renderBall()
        cmd(playing ? '/pause' : '/play', playing ? '暂停' : '播放')
        break
      }
      case 'prev':
        if (!state.connected) return
        cmd('/skip-prev', '上一首')
        break
      case 'next':
        if (!state.connected) return
        cmd('/skip-next', '下一首')
        break
      case 'collect': {
        if (!state.connected || !state.status.name) return
        const collected = !!state.status.collect
        hold('collect', HOLD.collect)
        state.status.collect = !collected
        renderSong()
        cmd(collected ? '/uncollect' : '/collect', collected ? '取消收藏' : '收藏').then(ok => {
          if (ok) showToast(collected ? '已取消收藏' : '已收藏')
        })
        break
      }
      case 'mute': {
        if (!state.connected) return
        const next = !state.status.mute
        hold('mute', HOLD.mute)
        state.status.mute = next
        renderVolume()
        cmd('/mute?mute=' + (next ? 'true' : 'false'), next ? '静音' : '取消静音')
        break
      }
      case 'search':
        doSearch()
        break
      case 'retry':
        showToast('正在重试连接…')
        schedulePoll(0)
        break
      case 'settings':
        els.settings.hidden = !els.settings.hidden
        if (!els.settings.hidden) {
          els.port.value = String(state.port)
          els.port.focus()
        }
        positionPanel()
        break
      case 'save-port': {
        const num = parseInt(els.port.value, 10)
        if (!num || num < 1 || num > 65535) {
          showToast('端口不合法', 'err')
          return
        }
        state.port = num
        state.base = 'http://' + API_HOST + ':' + num
        store.set('port', num)
        stopSSE(true)
        sse.enabled = true
        sse.errors = 0
        cache.addr = null
        state.connected = false
        render()
        showToast('已切换端口 ' + num + '，正在重连…')
        schedulePoll(0)
        break
      }
      default:
        break
    }
  })

  els.input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault()
      doSearch()
    }
  })

  /* 阻断事件冒泡到页面：避免在面板里打字触发站点快捷键、拖球触发页面手势 */
  const STOP_EVENTS = [
    'pointerdown', 'pointerup', 'pointermove',
    'mousedown', 'mouseup', 'click',
    'touchstart', 'touchend',
    'keydown', 'keyup', 'keypress',
  ]
  STOP_EVENTS.forEach(type => {
    host.addEventListener(type, e => { e.stopPropagation() })
  })

  document.addEventListener('pointerdown', e => {
    if (!state.panelOpen) return
    const path = e.composedPath ? e.composedPath() : []
    if (path.indexOf(host) >= 0 || path.indexOf(shadow) >= 0) return
    closePanel()
  }, true)

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && state.panelOpen) closePanel()
  }, true)

  window.addEventListener('resize', () => {
    clampBallPos()
    applyBallPos()
    snapIfNeeded()
    if (state.panelOpen) positionPanel()
  })

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) schedulePoll(0)
  })

  function snapIfNeeded() {
    const vw = window.innerWidth
    const nearLeft = ballPos.x < 70
    const nearRight = ballPos.x + BALL_SIZE > vw - 70
    if (nearLeft || nearRight) {
      snapBallPos()
      applyBallPos()
    }
  }

  /* ---------- Toast ---------- */
  let toastTimer = null
  function showToast(msg, type, sub) {
    els.toast.className = 'toast show' + (type === 'err' ? ' err' : '')
    els.toast.innerHTML = ''
    const main = document.createElement('div')
    main.textContent = msg
    els.toast.appendChild(main)
    if (sub) {
      const s = document.createElement('div')
      s.className = 'sub'
      s.textContent = sub
      els.toast.appendChild(s)
    }
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => {
      els.toast.classList.remove('show')
    }, type === 'err' ? 4500 : 3000)
  }

  /* ---------- 显隐与菜单命令 ---------- */
  let ballHidden = false

  function stopNetworking() {
    clearTimeout(pollTimer)
    stopSSE(false)
  }

  function startNetworking() {
    schedulePoll(0)
    if (sse.enabled) startSSE()
  }

  async function setVisible(visible) {
    ballHidden = !visible
    await store.set('hidden', !visible)
    if (visible) {
      if (!host.isConnected) document.documentElement.appendChild(host)
      clampBallPos()
      applyBallPos()
      startNetworking()
      showToast('悬浮球已显示')
    } else {
      closePanel()
      if (host.isConnected) host.remove()
      stopNetworking()
    }
  }

  function registerMenu() {
    const handler = () => { void setVisible(ballHidden) }
    if (typeof GM_registerMenuCommand === 'function') {
      GM_registerMenuCommand('显示 / 隐藏悬浮球', handler)
    } else if (typeof GM !== 'undefined' && GM && typeof GM.registerMenuCommand === 'function') {
      GM.registerMenuCommand('显示 / 隐藏悬浮球', handler)
    }
  }

  /* ---------- 启动 ---------- */
  async function boot() {
    // 端口：允许在面板底部修改（LX 设置里可能改过默认端口）
    const savedPort = parseInt(await store.get('port', DEFAULT_PORT), 10)
    if (savedPort >= 1 && savedPort <= 65535) {
      state.port = savedPort
      state.base = 'http://' + API_HOST + ':' + savedPort
    }

    // 位置：默认右上角，历史坐标按当前视口重新校正（换屏、改分辨率后不会飞出去）
    const savedPos = await store.get('pos', null)
    if (savedPos && typeof savedPos.x === 'number' && typeof savedPos.y === 'number') {
      ballPos.x = savedPos.x
      ballPos.y = savedPos.y
    } else {
      ballPos.x = window.innerWidth - BALL_SIZE - 18
      ballPos.y = 96
    }
    clampBallPos()

    registerMenu()

    ballHidden = !!(await store.get('hidden', false))
    if (ballHidden) return

    document.documentElement.appendChild(host)
    applyBallPos()

    renderConn()
    await fetchStatus()
    render()
    startNetworking()
  }

  void boot()
})()