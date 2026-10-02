// ==UserScript==
// @name         LX Music 便捷脚本
// @namespace    https://github.com/GZH201215/lx-music-easy-script
// @version      1.1.0
// @description  在任意网页遥控桌面版 LX Music：查看播放状态与歌词、控制播放/进度/音量/收藏、搜索选歌、桌面歌词浮层。
// @author       GZH201215
// @homepageURL  https://github.com/GZH201215/lx-music-easy-script
// @supportURL   https://github.com/GZH201215/lx-music-easy-script/issues
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0NDcuOTQyIiBoZWlnaHQ9IjQ0Ny45NDMiPjxwYXRoIGZpbGw9IiM1ZWQ2OTgiIGQ9Ik0yMDMuODA2LjQ4MmMtMTkuNjY4LTMuMzQ2LTM1Ljc2IDExLjEzOS0zNS43NiAzMS4wODZ2MjA2LjE2NmMtMTEuNjQyLTQuMjcxLTI0LjE2NS02LjcyNS0zNy4yODEtNi43MjUtNTkuOTA1IDAtMTA4LjQ2OSA0OC41NjYtMTA4LjQ2OSAxMDguNDczIDAgNTkuOTAzIDQ4LjU2NCAxMDguNDYxIDEwOC40NjkgMTA4LjQ2MSAzNC4xNDEgMCA2NC41NC0xNS44MiA4NC40MDYtNDAuNDgybC00OS42NTgtNDkuNjY0Yy0xNS4xMTYtMTUuMTEyLTExLjcwOC0yOC45MDEtOS41NDItMzQuMTQgMi4xNjYtNS4yMzMgOS41MTQtMTcuNCAzMC44ODMtMTcuNGgxOC4wODJ2LTU2Ljg4NWMwLTIxLjEzMiAxNC42MTctMzguODYyIDM0LjI2Ni00My43NDUuMDMyLTQ0LjM3My4wMzItODEuODA4LjAzMi04MS44MDggMTQwLjE0NyAwIDEzMS43MjQgODMuOTc0IDExNS4zMjUgMTMyLjE5Ni02LjQyIDE4Ljg4NC0yLjYwMSAyMi4wNSAxMC44OTMgNy4zNTRDNTM2LjQ3MyA3Ny4xMDYgMjk4LjM4IDE2LjU2NiAyMDMuODA2LjQ4MnoiLz48cGF0aCBmaWxsPSIjNGRhZjdjIiBkPSJNMzAxLjA2MSAyMjMuODc2aC01MC45OTRjLTMuOTExIDAtNy41NzQuOTUtMTAuODg5IDIuNTIzLTguNjE2IDQuMDktMTQuNjE1IDEyLjc5OC0xNC42MTUgMjIuOTczdjc2LjUxaC0zNy43MDhjLTE0LjA4MiAwLTE3LjQyOCA4LjA3MS03LjQ2NiAxOC4wMjlsNDYuODkzIDQ2Ljg5OCAzMS4yNSAzMS4yNDZhMjUuNDI0IDI1LjQyNCAwIDAwMTguMDMzIDcuNDc0YzYuNTIzIDAgMTMuMDUyLTIuNDg0IDE4LjAyOS03LjQ3NGw3OC4xNTItNzguMTQ1YzkuOTUxLTkuOTU4IDYuNjA4LTE4LjAyOS03LjQ3LTE4LjAyOWgtMzcuNzF2LTc2LjUxYy4wMDEtMTQuMDc4LTExLjQyLTI1LjQ5NS0yNS41MDUtMjUuNDk1eiIvPjwvc3ZnPg==
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
// @connect      music.163.com
// @connect      mobilecdn.kugou.com
// @run-at       document-start
// @noframes
// @license      MIT
// ==/UserScript==

/*
 * 说明（内部实现笔记）
 *
 * 通道一：LX Music 开放 API（HTTP，默认 http://127.0.0.1:23330）
 *   - 状态：GET /status?filter=...        → 一次拿全：播放状态、歌曲、歌词行、进度、音量、收藏
 *   - 歌词：GET /lyric（当前歌曲原始 LRC 文本）、GET /lyric-all（{lyric,tlyric,rlyric,lxlyric}）
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
 * 已核对源码（LX Music v2.12.6），以下结论决定了脚本的边界：
 *   - 开放 API 路由只有：/status /lyric /lyric-all /play /pause /skip-next /skip-prev
 *     /seek /collect /uncollect /volume /mute /subscribe-player-status，其余路径返回 401
 *   - /status 字段固定为 status、name、singer、albumName、picUrl、progress、duration、
 *     playbackRate、lyricLineText、lyricLineAllText、lyric、tlyric、rlyric、lxlyric、
 *     collect、volume、mute —— 不含 playMode
 *   - 播放模式（列表循环/随机/单曲/顺序）在 v2.12.6 没有任何 HTTP 或 Scheme 入口，
 *     脚本无法切换，因此不做假按钮（等客户端开放后再加）
 *   - Scheme 仅支持三类：
 *       music/{search,play,searchPlay}、songlist/{open,play}、
 *       player/{play,pause,skipNext,skipPrev,togglePlay,collect,uncollect,dislike}
 *     本地“喜欢列表”与歌手页没有 Scheme 入口，无法从浏览器唤起
 *   - searchPlay 在“正在播放”时才会立刻切歌；未播放时只是置顶到“稍后播放”
 *   - 客户端没有“只返回搜索结果”的接口，所以候选列表由公开元数据接口
 *     （网易云搜索，失败回退酷狗）提供；点选后仍走 searchPlay，由 LX 自己找源、解码、播放
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
  const VERSION = '1.1.0'
  const API_HOST = '127.0.0.1'
  const DEFAULT_PORT = 23330
  const FIELDS = [
    'status', 'name', 'singer', 'albumName', 'picUrl',
    'progress', 'duration', 'playbackRate',
    'lyricLineText', 'lyricLineAllText',
    'collect', 'volume', 'mute',
  ]
  const FILTER = FIELDS.join(',')

  // 连接抖动抑制（第七部分）：
  //   首次失败不算断开；7.5 秒内显示“连接中”，期间每 1.5 秒重试；任何一次成功立即恢复
  const JITTER_MS = 7500
  const PROBE_MS = 1500

  // 乐观更新的保持时间（毫秒）：本地操作后，短暂忽略服务端回包，避免控件“跳回去”
  // U4：控制指令改走 fetch 后回包只要毫秒级，保持窗口从 1200 收到 800
  const HOLD = { status: 800, progress: 1000, volume: 900, mute: 900, collect: 900 }

  // 超时（C3 / R3）：快速失败、快速恢复
  const T_STATUS = 1500 // GET /status
  const T_CMD = 1500    // 播放控制指令

  // U2 冷却锁：350ms 内同一种会互抢状态的操作只发一次，防连点打架
  const COOLDOWN_MS = 350

  const BALL_SIZE = 48
  const SEARCH_LIMIT = 12
  const HIST_MAX = 10

  const DEFAULTS = {
    poll: 2000,          // 常规轮询间隔（毫秒）
    sse: true,           // 优先 SSE
    floatOpacity: 0.92,  // 歌词浮层透明度
    floatFont: 'md',     // 歌词浮层字号：sm | md | lg
  }

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
    back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
    close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
    retract: 'M19 7v4H5.83l3.58-3.59L8 6l-6 6 6 6 1.41-1.41L5.83 13H21V7z',
    lock: 'M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1s3.1 1.39 3.1 3.1v2z',
    unlock: 'M12 17c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6-9h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h1.9c0-1.71 1.39-3.1 3.1-3.1s3.1 1.39 3.1 3.1v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2z',
    grip: 'M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
    history: 'M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.95 8.95 0 0 0 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z',
    expand: 'M12 8l-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z',
  }

  /* ============================================================
   * 设置存储（GM4 → GM3 → localStorage 逐级降级；键统一带 lxmes: 前缀）
   * ============================================================ */
  const store = {
    async get(key, def) {
      try {
        if (typeof GM_getValue === 'function') {
          const v = GM_getValue('lxmes:' + key, def)
          return v === undefined ? def : v
        }
        if (typeof GM !== 'undefined' && GM && typeof GM.getValue === 'function') {
          const v = await GM.getValue('lxmes:' + key, def)
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
          GM_setValue('lxmes:' + key, val)
          return
        }
        if (typeof GM !== 'undefined' && GM && typeof GM.setValue === 'function') {
          await GM.setValue('lxmes:' + key, val)
          return
        }
        if (window.localStorage) localStorage.setItem('lxmes:' + key, JSON.stringify(val))
      } catch (e) { /* 忽略存储失败 */ }
    },
    // 旧版本（≤1.0.0）没有 lxmes: 前缀，读一次做迁移
    async getLegacy(key, def) {
      try {
        if (typeof GM_getValue === 'function') {
          const v = GM_getValue(key, undefined)
          return v === undefined ? def : v
        }
        const raw = window.localStorage ? localStorage.getItem('lxmes:' + key) : null
        return raw == null ? def : JSON.parse(raw)
      } catch (e) {
        return def
      }
    },
  }

  /* ============================================================
   * 网络
   *
   * 通道选择（T1 / A2 / A3）：
   *   - 状态与控制指令优先走原生 fetch：http://127.0.0.1 属可信来源，HTTPS 页面
   *     也不受混合内容限制；LX 开放 API 自带 Access-Control-Allow-Origin: *，
   *     且 fetch 自动复用 TCP 连接（C1），延迟是毫秒级，而不是 GM 的进程间往返
   *   - fetch 被页面 CSP 拦下 / 环境不支持时自动回退 GM_xmlhttpRequest，
   *     回退后 30 秒内不再试 fetch，免得每条请求都先白等一次
   *   - 搜索用的公开元数据接口没有 CORS 头，继续直接走 GM（httpText）
   *   - 读请求 100ms 内的同 URL 合并（R2）；控制指令不去重，连点两下就该发两次
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

  async function httpText(url, timeout) {
    const res = await gmRequest(url, timeout || 3500)
    if (res.status === 200) return res.text
    const err = new Error((res.text || '').trim() || ('HTTP ' + res.status))
    err.httpStatus = res.status
    throw err
  }

  const NET = { fetchCooldown: 0, reads: new Map() }

  function fetchOnce(url, timeout) {
    return new Promise((resolve, reject) => {
      const ctrl = typeof AbortController === 'function' ? new AbortController() : null
      const timer = setTimeout(() => {
        if (ctrl) { try { ctrl.abort() } catch (e) { /* 忽略 */ } }
        reject(new Error('timeout'))
      }, timeout)
      const opt = { cache: 'no-store', credentials: 'omit' }
      if (ctrl) opt.signal = ctrl.signal
      fetch(url, opt).then(
        r => r.text().then(text => {
          clearTimeout(timer)
          resolve({ status: r.status, text })
        }),
        err => {
          clearTimeout(timer)
          reject(err)
        }
      )
    })
  }

  async function httpTextFast(url, timeout, dedupe) {
    const t = timeout || T_STATUS
    // R2：100ms 内重复的同一个读请求直接复用，不再发第二次
    if (dedupe) {
      const hit = NET.reads.get(url)
      const now = performance.now()
      if (hit && now - hit.at < 100) return hit.p
      const p = httpTextFast(url, t, false)
      NET.reads.set(url, { at: now, p })
      return p
    }
    if (Date.now() > NET.fetchCooldown && typeof fetch === 'function') {
      try {
        const res = await fetchOnce(url, t)
        if (res.status === 200) return res.text
        const err = new Error((res.text || '').trim() || ('HTTP ' + res.status))
        err.httpStatus = res.status // 服务端真实回包：说明 fetch 通道本身可用
        throw err
      } catch (e) {
        if (e && e.httpStatus) throw e
        NET.fetchCooldown = Date.now() + 30000
      }
    }
    return httpText(url, t)
  }

  // 状态 / 歌词等读请求：fetch 优先 + 同 URL 合并
  const apiRead = (path, timeout) => httpTextFast(state.base + path, timeout == null ? T_STATUS : timeout, true)
  // 控制指令：fetch 优先，不去重
  const apiCmd = (path, timeout) => httpTextFast(state.base + path, timeout == null ? T_CMD : timeout, false)

  /* ============================================================
   * 运行状态
   * ============================================================ */
  const state = {
    port: DEFAULT_PORT,
    base: 'http://' + API_HOST + ':' + DEFAULT_PORT,
    // 连接状态机：check（连接中/重试中）| ok | down —— 抖动抑制见 netOk/netFail
    link: 'check',
    checkAt: Date.now(),
    everConnected: false,
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
    lyricView: false,       // 面板内完整歌词页
    floatDetached: false,   // 桌面歌词浮层
    searchOpen: false,
  }

  const settings = {
    poll: DEFAULTS.poll,
    sse: DEFAULTS.sse,
    floatOpacity: DEFAULTS.floatOpacity,
    floatFont: DEFAULTS.floatFont,
    floatLocked: false,
  }

  // 轮询间隔：由设置中的“常规间隔”按场景伸缩
  function pollDelays() {
    const p = clamp(settings.poll, 500, 5000)
    return {
      fast: Math.max(500, Math.round(p / 2)),
      normal: p,
      idle: Math.min(6000, Math.round(p * 2)),
      hidden: Math.min(6000, Math.round(p * 3)),
      watchdog: clamp(Math.round(p * 5), 7500, 15000),
      retry: 3000,
      probe: PROBE_MS,
    }
  }

  // 乐观更新保持窗口
  const holds = {}
  function hold(key, ms) {
    holds[key] = Date.now() + ms
    // 保持窗口结束后主动同步一次，防止乐观值残留
    setTimeout(() => { if (!ballHidden) schedulePoll(0) }, ms + 250)
  }
  const isHeld = key => (holds[key] || 0) > Date.now()

  // U2：冷却锁 —— 只给“会互相抢状态”的操作上锁（播放/暂停、收藏、静音）。
  // 上一首/下一首不加锁：连点快速切歌是正常用法。
  const lastAct = {}
  function cooling(id) {
    const now = Date.now()
    if ((lastAct[id] || 0) + COOLDOWN_MS > now) return true
    lastAct[id] = now
    return false
  }

  // 进度条拖动中的临时值
  let progDrag = null
  let volDrag = null

  /* ============================================================
   * SSE 实时通道
   * ============================================================ */
  const sse = { enabled: true, es: null, alive: false, errors: 0 }

  function startSSE() {
    if (!settings.sse || !sse.enabled || sse.es) return
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
      netOk()
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
   * 状态同步与连接状态机（抖动抑制）
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
    checkLyrics()
  }

  // 一次成功的取数：立即恢复为已连接（CS-03：不累计失败）
  function netOk() {
    const was = state.link
    state.link = 'ok'
    state.checkAt = 0
    state.everConnected = true
    if (was !== 'ok') {
      render()
      // 连接恢复后，给 SSE 一次新的机会
      if (settings.sse && !sse.enabled) {
        sse.enabled = true
        sse.errors = 0
      }
      startSSE()
      // 断线期间错过了歌曲变化，补一次歌词
      checkLyrics(true)
    }
  }

  // 一次失败：ok → check（连接中）；check 持续超过 7.5 秒才判定断开（CS-01/05/06）
  function netFail() {
    if (state.link === 'down') return
    if (state.link === 'ok') {
      state.link = 'check'
      state.checkAt = Date.now()
      render()
      return
    }
    if (Date.now() - state.checkAt >= JITTER_MS) {
      state.link = 'down'
      stopSSE(false)
      render()
    }
  }

  // R1 单飞：轮询、断线重试、指令后刷新经常同时到点，同一时刻只保留一个 /status 在飞
  let statusFlight = null

  function fetchStatus() {
    if (statusFlight) return statusFlight
    const p = (async () => {
      try {
        const text = await apiRead('/status?filter=' + FILTER, T_STATUS)
        const data = JSON.parse(text)
        netOk()
        applyStatus(data)
      } catch (e) {
        netFail()
      } finally {
        if (statusFlight === p) statusFlight = null
      }
    })()
    statusFlight = p
    return p
  }

  /* 轮询循环 */
  let pollTimer = null

  function nextPollDelay() {
    const pd = pollDelays()
    if (state.link === 'down') return pd.retry
    if (state.link === 'check') return pd.probe
    if (sse.alive) return pd.watchdog
    if (document.hidden) return pd.hidden
    if (state.panelOpen || state.floatDetached) return pd.fast
    if (state.status.status === 'playing') return pd.normal
    return pd.idle
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

  // U3：pending 反馈 —— 指令在飞的时候按钮转圈；最短显示 180ms，否则快请求闪一下看不见
  function markPending(el, on) {
    if (el && el.classList) el.classList.toggle('pending', !!on)
  }

  async function cmd(path, label, btn) {
    const t0 = performance.now()
    markPending(btn, true)
    try {
      await apiCmd(path, T_CMD)
      if (state.link !== 'ok') netOk() // B5：任意一次成功立即恢复，不必等下一次轮询
      refreshSoon()
      return true
    } catch (e) {
      if (e.httpStatus) {
        showToast(label + '失败：' + e.message, 'err')
      } else {
        netFail()
        showToast('无法连接 LX Music', 'err', '请确认桌面端已启动、开放 API 已启用（默认端口 23330）')
      }
      return false
    } finally {
      const rest = 180 - (performance.now() - t0)
      if (rest > 0) setTimeout(() => markPending(btn, false), rest)
      else markPending(btn, false)
    }
  }

  /* ============================================================
   * 歌词（LRC 解析：完整歌词页 / 拖动预览 / 桌面歌词浮层共用）
   * ============================================================ */
  const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
  const ANGLE_TAG = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g

  function parseLrc(raw) {
    if (!raw) return []
    const out = []
    const lines = String(raw).split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      TIME_TAG.lastIndex = 0
      const times = []
      let m
      while ((m = TIME_TAG.exec(line))) {
        const min = parseInt(m[1], 10)
        const sec = parseInt(m[2], 10)
        let frac = 0
        if (m[3] != null) frac = parseInt(m[3].padEnd(3, '0').slice(0, 3), 10) / 1000
        times.push(min * 60 + sec + frac)
      }
      if (!times.length) continue
      const text = line.replace(TIME_TAG, '').replace(ANGLE_TAG, '').trim()
      if (!text) continue
      for (const t of times) out.push({ t, text })
    }
    out.sort((a, b) => a.t - b.t)
    const res = []
    for (const l of out) {
      const last = res[res.length - 1]
      if (last && Math.abs(last.t - l.t) < 0.01 && last.text === l.text) continue
      res.push(l)
    }
    return res
  }

  function mergeTrans(main, trans) {
    if (!trans.length) return main
    const byTime = new Map()
    for (const l of trans) byTime.set(Math.round(l.t * 20), l.text) // 50ms 一档
    return main.map((l, i) => {
      const k = Math.round(l.t * 20)
      let tr = byTime.get(k)
      if (!tr) tr = byTime.get(k + 1) || byTime.get(k - 1) || ''
      if (!tr && trans.length === main.length) tr = trans[i].text
      return { t: l.t, text: l.text, tr }
    })
  }

  const lyr = { key: '', lines: [], ready: false, loading: false }
  let lyrTimer = null

  function songKey() {
    const st = state.status
    if (!st.name) return ''
    return [st.name, st.singer, Math.round(st.duration || 0)].join('|')
  }

  function checkLyrics(force) {
    const key = songKey()
    if (!key) {
      clearTimeout(lyrTimer)
      lyrTimer = null
      if (lyr.key || lyr.lines.length) {
        lyr.key = ''
        lyr.lines = []
        lyr.ready = false
        renderLyricView()
        renderFloat()
      }
      return
    }
    // 已排队 / 已就绪 / 加载中就不再重新计时：SSE 推送很密，反复 clear+set 会让请求永不发出
    if (!force && key === lyr.key && (lyr.ready || lyr.loading || lyrTimer)) return
    if (key === lyr.key && lyr.loading) return
    lyr.key = key
    clearTimeout(lyrTimer)
    if (force) {
      lyrTimer = null
      void fetchLyrics(key)
    } else {
      lyrTimer = setTimeout(() => {
        lyrTimer = null
        void fetchLyrics(key)
      }, 350)
    }
  }

  async function fetchLyrics(key) {
    if (lyr.key !== key || lyr.loading) return
    lyr.loading = true
    lyr.ready = false
    renderLyricView()
    renderFloat()
    try {
      const text = await apiRead('/lyric-all', 6000)
      const data = JSON.parse(text)
      if (lyr.key !== key) return
      const main = parseLrc(data.lyric)
      const tr = parseLrc(data.tlyric)
      lyr.lines = mergeTrans(main, tr)
      lyr.ready = true
    } catch (e) {
      if (lyr.key === key) {
        lyr.lines = []
        lyr.ready = true
      }
    } finally {
      lyr.loading = false
      if (lyr.key === key) {
        renderLyricView(true)
        renderFloat()
      }
    }
  }

  // 哪一行在 t 秒（二分：最后一句开始时间 ≤ t）
  function lyrIndexAt(t) {
    const L = lyr.lines
    if (!L.length) return -1
    let lo = 0
    let hi = L.length - 1
    let ans = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (L[mid].t <= t + 0.25) { ans = mid; lo = mid + 1 } else hi = mid - 1
    }
    return ans
  }

  // 当前播放位置（本地插值，SSE 4Hz / 轮询 1s 都不卡顿）
  function nowProgress() {
    const st = state.status
    let p = st.progress || 0
    if (state.link === 'ok' && st.status === 'playing' && !isHeld('progress')) {
      p += ((performance.now() - state.syncAt) / 1000) * (st.playbackRate || 1)
    }
    return clamp(p, 0, st.duration || 0)
  }

  /* ============================================================
   * Scheme URL（搜索通道）
   * ============================================================ */
  function openScheme(url) {
    api.lastScheme = url
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

  function searchPlay(item) {
    const data = { name: item.name }
    if (item.singer) data.singer = item.singer
    if (item.album) data.albumName = item.album
    if (item.dur) data.interval = String(item.dur)
    openScheme('lxmusic://music/searchPlay?data=' + encodeURIComponent(JSON.stringify(data)))
    const playing = state.status.status === 'playing'
    showToast(
      (playing ? '即将播放：' : '已加入 LX Music 稍后播放：') + item.name + (item.singer ? ' - ' + item.singer : ''),
      'ok',
      playing ? '' : '客户端当前未在播放，点一下播放即可开始'
    )
  }

  /* ============================================================
   * 搜索（客户端没有“只列结果”的接口，这里用公开元数据接口列候选，
   *       点选后仍走 lxmusic://music/searchPlay，由 LX 自己找源播放）
   * ============================================================ */
  const search = { open: false, loading: false, q: '', results: [], error: '', hist: [] }

  async function providerNetease(q) {
    const url = 'https://music.163.com/api/search/get/web?s=' + encodeURIComponent(q) +
      '&type=1&offset=0&limit=' + SEARCH_LIMIT + '&total=false'
    const j = JSON.parse(await httpText(url, 6000))
    const songs = (j && j.result && j.result.songs) || []
    return songs.map(s => ({
      name: s.name || '',
      singer: (s.artists || []).map(a => a && a.name).filter(Boolean).join('/'),
      album: (s.album && s.album.name) || '',
      dur: Math.round((s.duration || 0) / 1000),
    })).filter(x => x.name)
  }

  async function providerKugou(q) {
    const url = 'http://mobilecdn.kugou.com/api/v3/search/song?format=json&keyword=' +
      encodeURIComponent(q) + '&page=1&pagesize=' + SEARCH_LIMIT
    const j = JSON.parse(await httpText(url, 6000))
    const info = (j && j.data && j.data.info) || []
    return info.map(s => ({
      name: s.songname || '',
      singer: s.singername || '',
      album: s.album_name || '',
      dur: s.duration || 0,
    })).filter(x => x.name)
  }

  async function providerSearch(q) {
    const providers = [providerNetease, providerKugou]
    for (const fn of providers) {
      try {
        const r = await fn(q)
        if (r && r.length) return r
      } catch (e) { /* 换下一个 */ }
    }
    return null
  }

  async function runSearch(q) {
    search.loading = true
    search.q = q
    search.error = ''
    search.results = []
    renderSearch(true)
    const res = await providerSearch(q)
    search.loading = false
    if (res) {
      search.results = res
      renderSearch(true)
      return
    }
    search.error = '搜索服务不可用'
    renderSearch(true)
    // 兜底：退回“直接让 LX 搜索并播放”，功能不断档
    let name = q
    let singer = ''
    const m = q.match(/^(.+?)\s+-\s+(.+)$/)
    if (m) {
      name = m[1].trim()
      singer = m[2].trim()
    }
    searchPlay({ name: name.slice(0, 200), singer: singer.slice(0, 200) })
  }

  function pushHistory(q) {
    const h = search.hist.filter(x => x !== q)
    h.unshift(q)
    search.hist = h.slice(0, HIST_MAX)
    store.set('search-hist', search.hist)
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
  --amber: #e8b64c;
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
/* 宿主不拦截页面交互：只有球、面板、浮层的交互件可点（pointer-events 可继承，子元素随之恢复） */
.ui { pointer-events: none; }
.ui .pe { pointer-events: auto; }

/* ---------- 悬浮球 ---------- */
.ball {
  position: fixed; width: ${BALL_SIZE}px; height: ${BALL_SIZE}px; border-radius: 50%;
  border: 0; padding: 0; cursor: pointer; user-select: none; touch-action: none;
  display: grid; place-items: center; color: #fff; outline: none;
  background: radial-gradient(120% 120% at 30% 22%, #7fdea9 0%, var(--c) 52%, var(--c-deep) 100%);
  box-shadow: 0 8px 20px -6px rgba(0,0,0,.45), 0 2px 6px rgba(0,0,0,.25), inset 0 1px 0 rgba(255,255,255,.35);
  transition: transform .18s cubic-bezier(.34,1.56,.64,1), filter .3s, opacity .2s, background .5s;
  -webkit-tap-highlight-color: transparent;
}
.ball:hover { transform: scale(1.07); }
.ball:active { transform: scale(.95); }
.ball.dragging { transition: none; cursor: grabbing; transform: scale(1.05); }
.ball.offline { background: radial-gradient(120% 120% at 30% 22%, #9aa4ac 0%, #6b767e 52%, #57626a 100%); }
.ball.paused { background: radial-gradient(120% 120% at 30% 22%, #f2cd7f 0%, #d9a83e 52%, #b7862b 100%); }
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
  position: fixed; width: 304px; max-width: calc(100vw - 24px);
  max-height: calc(100vh - 16px); overflow-y: auto; overscroll-behavior: contain;
  padding: 12px 12px 10px;
  border-radius: 16px; border: 1px solid rgba(255,255,255,.08);
  background: linear-gradient(165deg, rgba(34,40,45,.88), rgba(20,24,28,.9));
  -webkit-backdrop-filter: blur(20px) saturate(140%); backdrop-filter: blur(20px) saturate(140%);
  box-shadow: 0 24px 48px -16px rgba(0,0,0,.6), 0 4px 14px rgba(0,0,0,.3), inset 0 1px 0 rgba(255,255,255,.06);
  animation: lxePop .16s ease-out;
}
.panel::-webkit-scrollbar { width: 6px; }
.panel::-webkit-scrollbar-thumb { background: rgba(255,255,255,.14); border-radius: 3px; }
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
  transition: background .5s, box-shadow .5s, opacity .5s;
}
.dot.pause { background: var(--amber); box-shadow: 0 0 0 3px rgba(232,182,76,.16); }
.dot.off { background: var(--danger); box-shadow: 0 0 0 3px rgba(229,72,77,.16); }
.dot.check { animation: lxeBlink 1.1s ease-in-out infinite; }
@keyframes lxeBlink { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }

/* ---------- 歌词行（点击展开 / 拖出浮层） ---------- */
.lyric {
  margin: 10px 0 2px; min-height: 34px; text-align: center; border-radius: 8px;
  cursor: pointer; position: relative; padding: 2px 4px; touch-action: none;
  transition: background .15s;
}
.lyric:hover { background: rgba(255,255,255,.05); }
.lyric .l1 { font-size: 12.5px; color: rgba(238,242,245,.92); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lyric .l2 { font-size: 11px; color: var(--dim); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lyric.empty .l1 { color: var(--faint); }
.lyric .hint {
  position: absolute; right: 2px; top: -1px; color: var(--faint); opacity: 0; transition: opacity .15s;
}
.lyric:hover .hint { opacity: 1; }
.lyric.dragging { background: rgba(77,175,124,.12); }

/* ---------- 完整歌词页（面板内切换） ---------- */
.lyrview { margin: 8px 0 2px; }
.lv-head { display: flex; align-items: center; gap: 6px; padding: 0 2px 4px; border-bottom: 1px solid var(--line); }
.lv-head .lv-t { font-size: 12px; font-weight: 600; }
.lv-head .lv-h { margin-left: auto; font-size: 10px; color: var(--faint); }
.lv-head .btn { width: 26px; height: 26px; border-radius: 7px; }
.lv-body {
  height: 216px; overflow-y: auto; overscroll-behavior: contain; margin-top: 4px;
  scroll-behavior: smooth; padding: 4px 2px;
}
.lv-body::-webkit-scrollbar { width: 5px; }
.lv-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,.13); border-radius: 3px; }
.lv-line { padding: 5px 8px; border-radius: 8px; cursor: pointer; transition: background .12s; }
.lv-line:hover { background: rgba(255,255,255,.06); }
.lv-line .lv-txt { display: block; font-size: 12px; color: var(--dim); }
.lv-line .lv-tr { display: block; font-size: 10.5px; color: var(--faint); margin-top: 1px; }
.lv-line.cur .lv-txt { color: var(--c-light); font-weight: 600; font-size: 12.5px; }
.lv-line.cur { background: rgba(77,175,124,.1); }
.lv-empty { padding: 24px 8px; text-align: center; font-size: 11.5px; color: var(--faint); }
/* 歌词页展开时，面板其余区块让位 */
.panel.lyric-mode .lyric, .panel.lyric-mode .prow, .panel.lyric-mode .ctrl,
.panel.lyric-mode .vrow, .panel.lyric-mode .srow, .panel.lyric-mode .sbox { display: none; }

/* ---------- 进度条 ---------- */
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
.bar.dragging .knob { transform: translateX(-50%) scale(1.25); background: var(--c-light); }
.bar.disabled { cursor: default; opacity: .55; }
/* 拖动预览：进度条本体不动，只显示预览标记 + 时间气泡 */
.bar .pv-mark {
  position: absolute; top: 1px; bottom: 1px; width: 2px; border-radius: 1px;
  background: var(--c-light); transform: translateX(-50%); pointer-events: none;
  box-shadow: 0 0 6px rgba(111,211,156,.8);
}
.bar .pv-bubble {
  position: absolute; top: -24px; transform: translateX(-50%); pointer-events: none;
  padding: 2px 7px; border-radius: 7px; font-size: 10px; font-variant-numeric: tabular-nums;
  background: rgba(17,21,24,.95); border: 1px solid rgba(111,211,156,.5); color: #c9f3dc;
  white-space: nowrap;
}

/* ---------- 控制区 ---------- */
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

/* ---------- 音量 ---------- */
.vrow { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
.vrow .btn { width: 30px; height: 30px; }
.vrow .vnum { flex: 0 0 auto; min-width: 26px; text-align: right; font-size: 10.5px; color: var(--dim); font-variant-numeric: tabular-nums; }
.vbar { height: 16px; }
.vbar::before, .vbar .fill { height: 3px; }
.vbar .knob { width: 9px; height: 9px; }

/* ---------- 搜索（收起式：默认只露放大镜，点开才展开） ---------- */
.srow { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
.srow .btn { width: 32px; height: 32px; border-radius: 9px; }
.sbox { margin-top: 6px; }
.sline {
  display: flex; align-items: center; gap: 4px; height: 34px;
  padding: 0 4px 0 10px; border-radius: 10px; border: 1px solid var(--line);
  background: rgba(255,255,255,.06); transition: border-color .15s, box-shadow .15s;
}
.sline:focus-within { border-color: rgba(77,175,124,.55); box-shadow: 0 0 0 3px rgba(77,175,124,.14); }
.sline input { flex: 1; min-width: 0; height: 100%; border: 0; outline: none; background: transparent; color: var(--txt); font-size: 12px; font-family: inherit; }
.sline input::placeholder { color: var(--faint); }
.sline .go { width: 28px; height: 28px; border-radius: 8px; border: 0; background: transparent; color: var(--dim); cursor: pointer; display: grid; place-items: center; padding: 0; }
.sline .go:hover { background: rgba(255,255,255,.1); color: var(--txt); }
.slist { margin-top: 6px; max-height: 186px; overflow-y: auto; overscroll-behavior: contain; }
.slist::-webkit-scrollbar { width: 5px; }
.slist::-webkit-scrollbar-thumb { background: rgba(255,255,255,.13); border-radius: 3px; }
.sitem { display: flex; align-items: center; gap: 7px; padding: 6px 8px; border-radius: 8px; cursor: pointer; }
.sitem:hover { background: rgba(255,255,255,.07); }
.sitem .sn { max-width: 52%; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sitem .ss { flex: 1; min-width: 0; font-size: 10.5px; color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sitem .sd { flex: 0 0 auto; font-size: 10px; color: var(--faint); font-variant-numeric: tabular-nums; }
.sempty { padding: 14px 8px; text-align: center; font-size: 11px; color: var(--faint); }
.shrow { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 7px; }
.shrow .sh-t { width: 100%; font-size: 10px; color: var(--faint); }
.schip {
  border: 1px solid var(--line); background: rgba(255,255,255,.05); color: var(--dim);
  font-size: 11px; padding: 3px 9px; border-radius: 999px; cursor: pointer; font-family: inherit;
  max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.schip:hover { background: rgba(255,255,255,.11); color: var(--txt); }

/* ---------- 底部状态 ---------- */
.foot { display: flex; align-items: center; gap: 4px; margin-top: 9px; padding-top: 8px; border-top: 1px solid var(--line); font-size: 10.5px; color: var(--faint); }
.foot .addr { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.linkbtn {
  border: 0; background: transparent; color: var(--dim); cursor: pointer; font-size: 10.5px;
  padding: 3px 7px; border-radius: 6px; font-family: inherit; display: inline-grid; place-items: center;
}
.linkbtn:hover { background: rgba(255,255,255,.08); color: var(--txt); }

/* ---------- 断线提示 ---------- */
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

/* ---------- 设置 ---------- */
.setbox { margin-top: 9px; padding-top: 8px; border-top: 1px solid var(--line); }
.setbox .set-h { font-size: 11px; font-weight: 600; color: var(--dim); margin-bottom: 4px; }
.set-row { display: flex; align-items: center; gap: 6px; margin-top: 7px; min-height: 26px; }
.set-row > label { flex: 1; min-width: 0; font-size: 11px; color: var(--dim); }
.set-row input[type="text"] {
  width: 84px; height: 26px; padding: 0 8px; border-radius: 7px; outline: none;
  border: 1px solid var(--line); background: rgba(0,0,0,.25); color: var(--txt);
  font-size: 11.5px; font-family: inherit;
}
.set-row .sbtn {
  height: 26px; padding: 0 9px; border-radius: 7px; cursor: pointer; font-size: 11px; font-family: inherit;
  border: 1px solid var(--line); background: rgba(255,255,255,.06); color: var(--txt); white-space: nowrap;
}
.set-row .sbtn:hover { background: rgba(255,255,255,.12); }
.seg { display: inline-flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.seg button {
  border: 0; background: transparent; color: var(--dim); font-size: 10.5px; padding: 4px 8px;
  cursor: pointer; font-family: inherit; border-right: 1px solid var(--line);
}
.seg button:last-child { border-right: 0; }
.seg button.on { background: rgba(77,175,124,.2); color: #bdf0d4; }
.sw {
  width: 34px; height: 18px; border-radius: 999px; border: 1px solid var(--line);
  background: rgba(255,255,255,.08); position: relative; cursor: pointer; padding: 0;
  transition: background .18s, border-color .18s; flex: 0 0 auto;
}
.sw::after {
  content: ""; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px;
  border-radius: 50%; background: rgba(255,255,255,.7); transition: left .18s, background .18s;
}
.sw.on { background: rgba(77,175,124,.35); border-color: rgba(77,175,124,.6); }
.sw.on::after { left: 18px; background: #d9f7e6; }
.rng { -webkit-appearance: none; appearance: none; width: 96px; height: 14px; background: transparent; cursor: pointer; flex: 0 0 auto; }
.rng::-webkit-slider-runnable-track { height: 4px; border-radius: 2px; background: rgba(255,255,255,.16); }
.rng::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; margin-top: -4px; border-radius: 50%; background: var(--c-light); border: 0; }
.rng::-moz-range-track { height: 4px; border-radius: 2px; background: rgba(255,255,255,.16); }
.rng::-moz-range-thumb { width: 12px; height: 12px; border: 0; border-radius: 50%; background: var(--c-light); }

/* ---------- 右键菜单 ---------- */
.menu {
  position: fixed; min-width: 134px; padding: 5px; border-radius: 11px;
  border: 1px solid rgba(255,255,255,.1); background: rgba(26,31,35,.96);
  box-shadow: 0 16px 34px -12px rgba(0,0,0,.7); animation: lxePop .12s ease-out;
}
.menu button {
  display: block; width: 100%; text-align: left; border: 0; background: transparent; color: var(--txt);
  font-size: 12px; font-family: inherit; padding: 6px 9px; border-radius: 7px; cursor: pointer;
}
.menu button:hover { background: rgba(255,255,255,.09); }
.menu .sep { height: 1px; margin: 4px 6px; background: var(--line); }

/* ---------- 桌面歌词浮层（默认穿透，只有把手和按钮可点） ---------- */
.float-lyric {
  position: fixed; z-index: 2147483646; pointer-events: none; text-align: center;
  max-width: min(88vw, 920px); padding: 10px 20px 15px; border-radius: 12px;
  transition: opacity .25s, background .18s;
}
.float-lyric .fl-text {
  pointer-events: none; color: #fff; font-size: 15px; font-weight: 600; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis;
  text-shadow: 0 1px 3px rgba(0,0,0,.85), 0 0 12px rgba(0,0,0,.5);
}
.float-lyric .fl-tr {
  pointer-events: none; color: rgba(255,255,255,.78); font-size: .82em; margin-top: 4px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  text-shadow: 0 1px 3px rgba(0,0,0,.85);
}
.float-lyric.fs-sm .fl-text { font-size: 12.5px; }
.float-lyric.fs-md .fl-text { font-size: 15px; }
.float-lyric.fs-lg .fl-text { font-size: 18.5px; }
.float-lyric .fl-handle {
  position: absolute; left: 50%; bottom: 3px; transform: translateX(-50%);
  width: 40px; height: 4px; border-radius: 2px; background: rgba(77,175,124,.35);
  cursor: move; pointer-events: auto; transition: background .18s;
}
.float-lyric:hover .fl-handle { background: rgba(77,175,124,.8); }
.float-lyric.locked .fl-handle { display: none; }
.float-lyric .fl-controls {
  position: absolute; right: 2px; top: 2px; display: flex; gap: 2px;
  opacity: .35; transition: opacity .18s; pointer-events: auto;
}
.float-lyric:hover .fl-controls { opacity: 1; }
.fl-btn {
  width: 22px; height: 22px; border-radius: 6px; border: 0; background: rgba(20,24,28,.72);
  color: rgba(255,255,255,.85); cursor: pointer; display: grid; place-items: center; padding: 0;
}
.fl-btn:hover { background: rgba(77,175,124,.45); color: #fff; }
.fl-btn.on { color: #bdf0d4; }
.float-lyric.alt { background: rgba(17,21,24,.6); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); }
.float-lyric.alt .fl-text, .float-lyric.alt .fl-tr { pointer-events: auto; user-select: text; }
.float-lyric.dragging { transition: none; }

/* ---------- Toast ---------- */
.toast {
  position: fixed; left: 50%; bottom: 24px; transform: translate(-50%, 12px);
  max-width: min(420px, calc(100vw - 32px)); padding: 9px 14px; border-radius: 12px;
  background: rgba(23,27,31,.93); border: 1px solid var(--line); color: var(--txt);
  -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px);
  box-shadow: 0 12px 30px -10px rgba(0,0,0,.6);
  font-size: 12.5px; opacity: 0; pointer-events: none; transition: opacity .18s, transform .18s;
}
.toast.show { opacity: 1; transform: translate(-50%, 0); }
.toast.err { border-color: rgba(229,72,77,.45); }
.toast .sub { margin-top: 3px; font-size: 11px; color: var(--dim); }

@media (prefers-reduced-motion: reduce) {
  .ball.playing::before, .panel, .menu { animation: none; }
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
        <div class="t title">连接中…</div>
        <div class="s sub">在浏览器里遥控 LX Music</div>
      </div>
      <i class="dot check"></i>
    </div>

    <div class="lyric empty" title="单击展开歌词，按住可拖出浮层">
      <div class="l1">♪</div>
      <div class="l2" hidden></div>
      <span class="hint">${icon(ICON.expand, 13)}</span>
    </div>

    <div class="lyrview" hidden>
      <div class="lv-head">
        <button class="btn" type="button" data-act="lv-back" aria-label="返回">${icon(ICON.back, 15)}</button>
        <span class="lv-t">歌词</span>
        <span class="lv-h">点击歌词跳转</span>
      </div>
      <div class="lv-body"></div>
    </div>

    <div class="prow">
      <span class="time t-cur">00:00</span>
      <div class="bar pbar" data-role="progress">
        <i class="fill"></i>
        <i class="knob"></i>
        <i class="pv-mark" hidden></i>
        <span class="pv-bubble" hidden></span>
      </div>
      <span class="time t-total">00:00</span>
    </div>

    <div class="ctrl">
      <button class="btn" type="button" data-act="prev" aria-label="上一首">${icon(ICON.prev)}</button>
      <button class="btn main" type="button" data-act="toggle" aria-label="播放 / 暂停">${icon(ICON.play, 24)}</button>
      <button class="btn" type="button" data-act="next" aria-label="下一首">${icon(ICON.next)}</button>
      <button class="btn collect" type="button" data-act="collect" aria-label="收藏">${icon(ICON.heartOutline)}</button>
    </div>

    <div class="vrow">
      <button class="btn mute" type="button" data-act="mute" aria-label="静音">${icon(ICON.vol, 18)}</button>
      <div class="bar vbar" data-role="volume"><i class="fill"></i><i class="knob"></i></div>
      <span class="vnum">0</span>
    </div>

    <div class="srow">
      <button class="btn" type="button" data-act="search-toggle" aria-label="搜索并播放" title="搜索并播放">${icon(ICON.search, 17)}</button>
    </div>

    <div class="sbox" hidden>
      <div class="sline">
        <input class="q" type="text" placeholder="歌名 或 歌名 - 歌手" aria-label="搜索">
        <button class="go" type="button" data-act="search-go" aria-label="搜索">${icon(ICON.search, 15)}</button>
      </div>
      <div class="slist" hidden></div>
      <div class="shrow" hidden></div>
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

    <div class="foot">
      <span class="addr">连接中…</span>
      <button class="linkbtn" type="button" data-act="retry">重试</button>
      <button class="linkbtn" type="button" data-act="settings" aria-label="设置" title="设置">${icon(ICON.gear, 13)}</button>
    </div>

    <div class="setbox" hidden>
      <div class="set-h">设置</div>
      <div class="set-row">
        <label>开放 API 端口</label>
        <input class="port" type="text" inputmode="numeric" placeholder="23330">
        <button class="sbtn" type="button" data-act="save-port">保存并重连</button>
      </div>
      <div class="set-row">
        <label>轮询间隔</label>
        <div class="seg" data-seg="poll"></div>
      </div>
      <div class="set-row">
        <label>优先使用 SSE 实时推送</label>
        <button class="sw" type="button" data-act="toggle-sse" aria-label="SSE 开关"></button>
      </div>
      <div class="set-row">
        <label>歌词浮层透明度</label>
        <input class="rng" type="range" min="40" max="100" step="5" aria-label="浮层透明度">
      </div>
      <div class="set-row">
        <label>浮层字号</label>
        <div class="seg" data-seg="font"></div>
      </div>
      <div class="set-row">
        <label>锁定浮层位置</label>
        <button class="sw" type="button" data-act="toggle-lock" aria-label="锁定浮层"></button>
      </div>
      <div class="set-row">
        <label>悬浮球与浮层位置</label>
        <button class="sbtn" type="button" data-act="reset-pos">重置位置</button>
      </div>
      <div class="set-row">
        <label>打开歌单</label>
        <input class="listid" type="text" placeholder="wy:3778678">
        <button class="sbtn" type="button" data-act="open-list">打开</button>
      </div>
      <div class="set-row">
        <label>设置只保存在本机</label>
        <button class="sbtn" type="button" data-act="defaults">恢复默认</button>
      </div>
    </div>
  </section>

  <div class="float-lyric" hidden>
    <div class="fl-text">♪</div>
    <div class="fl-tr" hidden></div>
    <div class="fl-handle" data-fl="drag" title="拖动浮层"></div>
    <div class="fl-controls">
      <button class="fl-btn fl-lock" type="button" data-fl="lock" aria-label="锁定浮层" title="锁定位置">${icon(ICON.unlock, 12)}</button>
      <button class="fl-btn" type="button" data-fl="retract" aria-label="收回面板" title="收回面板">${icon(ICON.retract, 12)}</button>
    </div>
  </div>

  <div class="menu pe" hidden>
    <button type="button" data-act="m-toggle" class="m-toggle">播放 / 暂停</button>
    <button type="button" data-act="m-prev">上一首</button>
    <button type="button" data-act="m-next">下一首</button>
    <div class="sep"></div>
    <button type="button" data-act="m-retry">重连</button>
    <button type="button" data-act="m-hide">隐藏悬浮球</button>
  </div>

  <div class="toast" role="status"></div>
</div>
`

  const $ = sel => shadow.querySelector(sel)
  const $$ = sel => Array.prototype.slice.call(shadow.querySelectorAll(sel))
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
    lyrview: $('.lyrview'),
    lvBody: $('.lv-body'),
    lvT: $('.lv-head .lv-t'),
    pbar: $('.pbar'),
    pvMark: $('.pv-mark'),
    pvBubble: $('.pv-bubble'),
    tCur: $('.t-cur'),
    tTotal: $('.t-total'),
    toggleBtn: $('[data-act="toggle"]'),
    collectBtn: $('.collect'),
    muteBtn: $('.mute'),
    vbar: $('.vbar'),
    vnum: $('.vnum'),
    searchToggle: $('[data-act="search-toggle"]'),
    sbox: $('.sbox'),
    sq: $('.sline .q'),
    slist: $('.slist'),
    shrow: $('.shrow'),
    offline: $('.offline'),
    addr: $('.addr'),
    setbox: $('.setbox'),
    port: $('.setbox .port'),
    sseSw: $('[data-act="toggle-sse"]'),
    lockSw: $('[data-act="toggle-lock"]'),
    rng: $('.rng'),
    listIn: $('.listid'),
    segPoll: $('[data-seg="poll"]'),
    segFont: $('[data-seg="font"]'),
    float: $('.float-lyric'),
    flText: $('.fl-text'),
    flTr: $('.fl-tr'),
    flHandle: $('.fl-handle'),
    flLock: $('.fl-lock'),
    menu: $('.menu'),
    menuToggle: $('.m-toggle'),
    toast: $('.toast'),
  }

  const RING_LEN = 2 * Math.PI * 21.5
  els.ringBar.style.strokeDasharray = String(RING_LEN)
  els.ringBar.style.strokeDashoffset = String(RING_LEN)

  /* ============================================================
   * 通用：HTML 转义 / 文本缓存 / 全局句柄
   * ============================================================ */
  const api = { lastScheme: '' }   // 最近一次 Scheme 调用（调试用）
  let ballHidden = false           // 通过脚本菜单或右键菜单隐藏后不再轮询

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
    ))
  }

  const cache = {}
  function setText(el, text, key) {
    if (cache[key] === text) return
    cache[key] = text
    el.textContent = text
  }

  // document-start 下 documentElement 可能还没建好，等它出现再挂载
  function whenReady() {
    if (document.documentElement) return Promise.resolve()
    return new Promise(resolve => {
      const obs = new MutationObserver(() => {
        if (document.documentElement) { obs.disconnect(); resolve() }
      })
      obs.observe(document, { childList: true, subtree: true })
      setTimeout(() => { obs.disconnect(); resolve() }, 5000)
    })
  }

  /* ============================================================
   * 悬浮球：位置、拖拽、边缘吸附（跨页面保持：lxmes:ball-pos）
   * ============================================================ */
  const ballPos = { x: 0, y: 0 }

  function applyBallPos() {
    els.ball.style.left = Math.round(ballPos.x) + 'px'
    els.ball.style.top = Math.round(ballPos.y) + 'px'
  }

  function clampBallPos() {
    ballPos.x = clamp(ballPos.x, 6, Math.max(6, window.innerWidth - BALL_SIZE - 6))
    ballPos.y = clamp(ballPos.y, 6, Math.max(6, window.innerHeight - BALL_SIZE - 6))
  }

  function saveBallPos() {
    store.set('ball-pos', { x: Math.round(ballPos.x), y: Math.round(ballPos.y) })
  }

  function snapBallPos() {
    const margin = 12
    const vw = window.innerWidth
    if (ballPos.x < 70) ballPos.x = margin
    else if (ballPos.x + BALL_SIZE > vw - 70) ballPos.x = vw - margin - BALL_SIZE
    clampBallPos()
    saveBallPos()
  }

  function defaultBallPos() {
    ballPos.x = window.innerWidth - BALL_SIZE - 18
    ballPos.y = 96
    clampBallPos()
  }

  els.ball.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    const originX = ballPos.x
    const originY = ballPos.y
    let moved = false
    try { els.ball.setPointerCapture(e.pointerId) } catch (err) { /* 忽略 */ }

    const onMove = ev => {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      if (!moved && Math.abs(dx) + Math.abs(dy) > 4) {
        moved = true
        els.ball.classList.add('dragging')
        closeMenu()
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
      if (!moved) {
        togglePanel()
      } else {
        snapBallPos()
        applyBallPos()
        if (state.panelOpen) positionPanel()
      }
    }
    els.ball.addEventListener('pointermove', onMove)
    els.ball.addEventListener('pointerup', onUp)
    els.ball.addEventListener('pointercancel', onUp)
  })

  els.ball.addEventListener('contextmenu', e => {
    e.preventDefault()
    showMenu(e.clientX, e.clientY)
  })

  /* ============================================================
   * 面板：贴着球定位、展开/收起、展开状态跨页面保持（lxmes:panel-open）
   * ============================================================ */
  function positionPanel() {
    const gap = 10
    const vw = window.innerWidth
    const vh = window.innerHeight
    const pw = els.panel.offsetWidth || 304
    const ph = els.panel.offsetHeight || 320
    let x
    if (ballPos.x + BALL_SIZE / 2 > vw / 2) x = ballPos.x - pw - gap
    else x = ballPos.x + BALL_SIZE + gap
    x = clamp(x, 8, Math.max(8, vw - pw - 8))
    const y = clamp(ballPos.y - 6, 8, Math.max(8, vh - ph - 8))
    els.panel.style.left = Math.round(x) + 'px'
    els.panel.style.top = Math.round(y) + 'px'
  }

  function openPanel(silent) {
    if (state.panelOpen) return
    state.panelOpen = true
    els.panel.hidden = false
    render()
    positionPanel()
    schedulePoll(pollDelays().fast)
    if (!silent) store.set('panel-open', true)
  }

  function closePanel() {
    if (!state.panelOpen) return
    state.panelOpen = false
    els.panel.hidden = true
    closeMenu()
    if (search.open) closeSearch()
    if (state.lyricView) {
      state.lyricView = false
      renderLyricView()
    }
    store.set('panel-open', false)
    schedulePoll()
  }

  function togglePanel() {
    if (state.panelOpen) closePanel()
    else openPanel()
  }

  /* ============================================================
   * 右键菜单（播放/暂停、上下一首、重连、隐藏）
   * ============================================================ */
  function showMenu(x, y) {
    els.menu.hidden = false
    setText(els.menuToggle, state.status.status === 'playing' ? '暂停' : '播放', 'mtg')
    const mw = els.menu.offsetWidth || 134
    const mh = els.menu.offsetHeight || 170
    els.menu.style.left = Math.round(clamp(x, 6, Math.max(6, window.innerWidth - mw - 6))) + 'px'
    els.menu.style.top = Math.round(clamp(y, 6, Math.max(6, window.innerHeight - mh - 6))) + 'px'
  }

  function closeMenu() {
    if (!els.menu.hidden) els.menu.hidden = true
  }

  /* ============================================================
   * 渲染：连接状态 / 歌曲 / 歌词行 / 控制 / 进度 / 音量
   * ============================================================ */
  function renderConn() {
    const link = state.link
    const down = link === 'down'
    const live = !down                                   // 连接中保持上一次形态（抖动抑制 CS-05）
    const playing = state.status.status === 'playing'
    const known = state.everConnected && live
    els.ball.classList.toggle('offline', down || !state.everConnected)
    els.ball.classList.toggle('playing', !down && known && playing)
    els.ball.classList.toggle('paused', !down && known && !playing)
    els.dot.classList.toggle('off', down)
    els.dot.classList.toggle('check', link === 'check')
    els.dot.classList.toggle('pause', !down && state.everConnected && !playing)
    els.offline.hidden = !down
    const addr = API_HOST + ':' + state.port
    setText(els.addr,
      link === 'ok' ? ('已连接 ' + addr) : (link === 'check' ? ('连接中… ' + addr) : ('未连接 · ' + addr)),
      'addr')
    els.ui.classList.toggle('connected', link === 'ok')
    renderBall()
  }

  function renderBall() {
    let title = 'LX Music'
    if (state.link === 'down') title = '未连接到 LX Music'
    else if (state.link === 'check') title = '连接中…'
    else if (state.status.name) title = state.status.name + (state.status.singer ? ' - ' + state.status.singer : '')
    if (cache.ballTitle !== title) {
      cache.ballTitle = title
      els.ball.title = title
      els.ball.setAttribute('aria-label', title + ' · 点击展开面板')
    }
  }

  function renderCover() {
    const url = state.link !== 'down' ? (state.status.picUrl || '') : ''
    if (cache.coverUrl === url) return
    cache.coverUrl = url
    const svg = els.cover.querySelector('svg')
    if (url) {
      if (svg) svg.style.display = 'none'
      els.coverImg.style.display = ''
      els.coverImg.src = url
    } else {
      els.coverImg.style.display = 'none'
      els.coverImg.removeAttribute('src')
      if (svg) svg.style.display = ''
    }
  }

  function renderSong() {
    const st = state.status
    const live = state.link !== 'down'
    const has = live && !!st.name
    setText(els.title, has ? st.name : (live ? '暂无播放' : '未连接到 LX Music'), 'title')
    setText(els.sub, has ? [st.singer, st.albumName].filter(Boolean).join(' · ') : (live ? '在浏览器里遥控 LX Music' : ''), 'sub')

    const line = has ? (st.lyricLineText || '') : ''
    const all = has ? (st.lyricLineAllText || '') : ''
    const tr = all.split('\n').slice(1).join(' / ').trim()
    els.lyric.classList.toggle('empty', !line)
    setText(els.lyric1, line || '♪', 'l1')
    els.lyric2.hidden = !tr
    if (tr) setText(els.lyric2, tr, 'l2')
    else cache.l2 = ''

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
    if (progDrag) return
    const st = state.status
    const dur = st.duration || 0
    const p = clamp(sec == null ? st.progress : sec, 0, dur || 0)
    const ratio = dur > 0 ? p / dur : 0
    const pct = (ratio * 100).toFixed(2) + '%'
    if (cache.pct !== pct) {
      cache.pct = pct
      const fill = els.pbar.querySelector('.fill')
      const knob = els.pbar.querySelector('.knob')
      if (fill) fill.style.width = pct
      if (knob) knob.style.left = pct
      els.ringBar.style.strokeDashoffset = String(RING_LEN * (1 - ratio))
    }
    setText(els.tCur, fmtTime(p), 'tcur')
    setText(els.tTotal, fmtTime(dur), 'ttot')
    els.pbar.classList.toggle('disabled', state.link !== 'ok' || !dur)
  }

  function renderVolume() {
    const st = state.status
    const v = clamp(st.volume || 0, 0, 100)
    if (cache.vpct !== v) {
      cache.vpct = v
      cache.vnum = String(v)
      const pct = v + '%'
      const fill = els.vbar.querySelector('.fill')
      const knob = els.vbar.querySelector('.knob')
      if (fill) fill.style.width = pct
      if (knob) knob.style.left = pct
      els.vnum.textContent = String(v)
    }
    const key = st.mute ? 'mute' : 'vol'
    if (cache.muteIcon !== key) {
      cache.muteIcon = key
      els.muteBtn.innerHTML = icon(st.mute ? ICON.mute : ICON.vol, 18)
      els.muteBtn.classList.toggle('on', !!st.mute)
    }
  }

  function render() {
    renderConn()
    renderCover()
    renderSong()
    renderPlayBtn()
    renderVolume()
    if (!progDrag) renderProgress(nowProgress())
    if (state.lyricView) updateLyricHighlight()
    renderFloat()
  }

  /* 播放中：本地插值让进度、歌词高亮、浮层随播放平滑推进（SSE 4Hz / 轮询 1s 都不卡） */
  setInterval(() => {
    if (progDrag) return
    const st = state.status
    if (state.link !== 'ok' || st.status !== 'playing' || !st.duration) return
    if (isHeld('progress')) return
    renderProgress(nowProgress())
    if (state.lyricView) updateLyricHighlight()
    renderFloat()
  }, 500)

  /* ============================================================
   * 进度条拖动（第六部分）：条不动、气泡报时间、歌词预览、松手才 seek
   * ============================================================ */
  function barRatio(bar, clientX) {
    const r = bar.getBoundingClientRect()
    return clamp((clientX - r.left) / (r.width || 1), 0, 1)
  }

  // PB-02：拖到哪显示哪句歌词
  function previewLyric(t) {
    const idx = lyrIndexAt(t)
    const line = idx >= 0 ? lyr.lines[idx] : null
    els.lyric.classList.add('preview')
    els.lyric.classList.toggle('empty', !line)
    els.lyric1.textContent = line ? line.text : '♪'
    if (line && line.tr) {
      els.lyric2.hidden = false
      els.lyric2.textContent = line.tr
    } else {
      els.lyric2.hidden = true
    }
  }

  function endLyricPreview() {
    els.lyric.classList.remove('preview')
    cache.l1 = null
    cache.l2 = null
    renderSong()
  }

  // PB-01：拖动时不挪进度条本体，只显示预览标记 + 时间气泡
  function showProgPreview() {
    const dur = state.status.duration || 0
    const ratio = dur > 0 ? clamp(progDrag.t / dur, 0, 1) : 0
    const pct = (ratio * 100).toFixed(2) + '%'
    els.pvMark.hidden = false
    els.pvMark.style.left = pct
    els.pvBubble.hidden = false
    els.pvBubble.style.left = pct
    setText(els.pvBubble, fmtTime(progDrag.t), 'pvb')
  }

  function hideProgPreview() {
    els.pvMark.hidden = true
    els.pvBubble.hidden = true
  }

  els.pbar.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (state.link !== 'ok' || !state.status.duration) return
    e.preventDefault()
    const r = barRatio(els.pbar, e.clientX)
    progDrag = { t: r * state.status.duration }
    els.pbar.classList.add('dragging')
    try { els.pbar.setPointerCapture(e.pointerId) } catch (err) { /* 忽略 */ }
    showProgPreview()
    previewLyric(progDrag.t)
  })

  els.pbar.addEventListener('pointermove', e => {
    if (!progDrag) return
    const r = barRatio(els.pbar, e.clientX)
    progDrag.t = r * (state.status.duration || 0)
    showProgPreview()
    previewLyric(progDrag.t)
  })

  // PB-03：松手才发 /seek；PB-04：拖动全程不碰播放状态
  function endProgDrag(commit) {
    if (!progDrag) return
    const t = progDrag.t
    progDrag = null
    els.pbar.classList.remove('dragging')
    hideProgPreview()
    endLyricPreview()
    if (!commit) return
    const secs = clamp(Math.round(t), 0, Math.floor(state.status.duration || 0))
    hold('progress', HOLD.progress)
    state.status.progress = secs
    state.syncAt = performance.now()
    renderProgress(secs)
    apiCmd('/seek?offset=' + secs, T_CMD).then(() => refreshSoon(400)).catch(e => {
      if (!e.httpStatus) netFail()
      render()
    })
  }
  els.pbar.addEventListener('pointerup', () => endProgDrag(true))
  els.pbar.addEventListener('pointercancel', () => endProgDrag(false))

  /* ---------- 音量拖动 ---------- */
  function renderVolumePreview(v) {
    v = clamp(v, 0, 100)
    cache.vpct = v
    cache.vnum = String(v)
    const fill = els.vbar.querySelector('.fill')
    const knob = els.vbar.querySelector('.knob')
    const pct = v + '%'
    if (fill) fill.style.width = pct
    if (knob) knob.style.left = pct
    els.vnum.textContent = String(v)
  }

  els.vbar.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (state.link !== 'ok') return
    e.preventDefault()
    const r = barRatio(els.vbar, e.clientX)
    volDrag = { value: Math.round(r * 100) }
    els.vbar.classList.add('dragging')
    try { els.vbar.setPointerCapture(e.pointerId) } catch (err) { /* 忽略 */ }
    renderVolumePreview(volDrag.value)
  })

  els.vbar.addEventListener('pointermove', e => {
    if (!volDrag) return
    volDrag.value = Math.round(barRatio(els.vbar, e.clientX) * 100)
    renderVolumePreview(volDrag.value)
  })

  function endVolDrag(commit) {
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
    apiCmd('/volume?volume=' + value, T_CMD).then(() => refreshSoon(500)).catch(e => {
      if (!e.httpStatus) netFail()
      renderVolume()
    })
  }
  els.vbar.addEventListener('pointerup', () => endVolDrag(true))
  els.vbar.addEventListener('pointercancel', () => endVolDrag(false))

  /* ============================================================
   * 完整歌词页（面板内切换，P-06 / P-07）
   * ============================================================ */
  function renderLyricView(force) {
    const on = !!state.lyricView
    els.panel.classList.toggle('lyric-mode', on)
    els.lyrview.hidden = !on
    if (!on) {
      cache.lvKey = ''
      return
    }
    const key = lyr.key + '|' + lyr.lines.length + '|' + (lyr.loading ? 'L' : lyr.ready ? 'R' : 'W')
    if (!force && cache.lvKey === key && els.lvBody.childNodes.length) {
      updateLyricHighlight()
      return
    }
    cache.lvKey = key
    setText(els.lvT, state.status.name || '歌词', 'lvt')
    if (lyr.loading && !lyr.lines.length) {
      els.lvBody.innerHTML = '<div class="lv-empty">歌词加载中…</div>'
    } else if (!lyr.lines.length) {
      els.lvBody.innerHTML = '<div class="lv-empty">' +
        (state.link === 'down' ? '未连接到 LX Music' : '暂无歌词') + '</div>'
    } else {
      els.lvBody.innerHTML = lyr.lines.map(l =>
        '<div class="lv-line" data-act="seek-line" data-t="' + l.t.toFixed(2) + '">' +
          '<span class="lv-txt">' + esc(l.text) + '</span>' +
          (l.tr ? '<span class="lv-tr">' + esc(l.tr) + '</span>' : '') +
        '</div>'
      ).join('')
    }
    els.lvBody.scrollTop = 0
    updateLyricHighlight(true)
  }

  // DL-05 的面板内版本：高亮当前行并自动滚动
  function updateLyricHighlight(force) {
    if (!state.lyricView || !lyr.lines.length) return
    const idx = lyrIndexAt(nowProgress())
    if (!force && cache.lvCur === idx) return
    cache.lvCur = idx
    const prev = els.lvBody.querySelector('.lv-line.cur')
    if (prev) prev.classList.remove('cur')
    const el = idx >= 0 ? els.lvBody.children[idx] : null
    if (!el || !el.classList) return
    el.classList.add('cur')
    const top = el.offsetTop - els.lvBody.clientHeight * 0.38
    els.lvBody.scrollTop = Math.max(0, top)
  }

  function openLyricView() {
    state.lyricView = true
    renderLyricView(true)
    if (state.panelOpen) positionPanel()
  }

  function closeLyricView() {
    state.lyricView = false
    renderLyricView()
    if (state.panelOpen) positionPanel()
  }

  /* ============================================================
   * 桌面歌词浮层（第八部分：默认穿透，把手可拖，按钮可点）
   * ============================================================ */
  const floatPos = { x: null, y: null }

  function floatSize() {
    return { w: els.float.offsetWidth || 360, h: els.float.offsetHeight || 56 }
  }

  function clampFloatPos() {
    const s = floatSize()
    const x = floatPos.x == null ? 0 : floatPos.x
    const y = floatPos.y == null ? 0 : floatPos.y
    floatPos.x = clamp(x, 4, Math.max(4, window.innerWidth - s.w - 4))
    floatPos.y = clamp(y, 4, Math.max(4, window.innerHeight - s.h - 4))
  }

  function defaultFloatPos() {
    const s = floatSize()
    floatPos.x = Math.round((window.innerWidth - s.w) / 2)
    floatPos.y = Math.round(window.innerHeight - s.h - 64)
    clampFloatPos()
  }

  function applyFloatPos() {
    if (floatPos.x == null || floatPos.y == null) defaultFloatPos()
    else clampFloatPos()
    els.float.style.left = Math.round(floatPos.x) + 'px'
    els.float.style.top = Math.round(floatPos.y) + 'px'
  }

  function saveFloatPos() {
    if (floatPos.x == null || floatPos.y == null) return
    store.set('lyric-pos', { x: Math.round(floatPos.x), y: Math.round(floatPos.y) })
  }

  function applyFloatStyle() {
    els.float.classList.toggle('fs-sm', settings.floatFont === 'sm')
    els.float.classList.toggle('fs-md', settings.floatFont === 'md')
    els.float.classList.toggle('fs-lg', settings.floatFont === 'lg')
    els.float.style.opacity = String(settings.floatOpacity)
  }

  function applyFloatLock() {
    els.float.classList.toggle('locked', !!settings.floatLocked)
    els.lockSw.classList.toggle('on', !!settings.floatLocked)
    els.flLock.classList.toggle('on', !!settings.floatLocked)
    const ico = settings.floatLocked ? ICON.lock : ICON.unlock
    if (cache.flLockIcon !== ico) {
      cache.flLockIcon = ico
      els.flLock.innerHTML = icon(ico, 12)
    }
    els.flLock.setAttribute('title', settings.floatLocked ? '解锁位置' : '锁定位置')
  }

  function renderFloat() {
    const on = state.floatDetached && state.link !== 'down'
    els.float.hidden = !on
    if (!on) return
    const idx = lyrIndexAt(nowProgress())
    const line = idx >= 0 && lyr.lines.length ? lyr.lines[idx] : null
    const text = (line && line.text) || state.status.lyricLineText || '♪'
    const tr = (line && line.tr) || ''
    setText(els.flText, text, 'flt')
    els.flTr.hidden = !tr
    if (tr) setText(els.flTr, tr, 'fltr')
  }

  // DL-01：从面板歌词区拖出（x/y 为指针位置，null 表示居中出栈）
  function detachFloat(x, y) {
    state.floatDetached = true
    store.set('lyric-detached', true)
    renderFloat()
    applyFloatStyle()
    const s = floatSize()
    floatPos.x = x == null ? (window.innerWidth - s.w) / 2 : x - s.w / 2
    floatPos.y = y == null ? window.innerHeight - s.h - 64 : y - s.h / 2
    applyFloatPos()
    saveFloatPos()
  }

  function retractFloat() {
    state.floatDetached = false
    store.set('lyric-detached', false)
    renderFloat()
    showToast('歌词已收回面板')
  }

  function overPanel(x, y) {
    if (!state.panelOpen) return false
    const r = els.panel.getBoundingClientRect()
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
  }

  /* 面板歌词行：单击 → 展开完整歌词页；拖动 → 拖出浮层 */
  els.lyric.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    let dragging = false
    let offX = 0
    let offY = 0
    try { els.lyric.setPointerCapture(e.pointerId) } catch (err) { /* 忽略 */ }

    const onMove = ev => {
      if (!dragging && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 8) {
        dragging = true
        els.lyric.classList.add('dragging')
        detachFloat(ev.clientX, ev.clientY)
        offX = ev.clientX - floatPos.x
        offY = ev.clientY - floatPos.y
      }
      if (!dragging) return
      floatPos.x = ev.clientX - offX
      floatPos.y = ev.clientY - offY
      clampFloatPos()
      applyFloatPos()
    }
    const onUp = () => {
      els.lyric.removeEventListener('pointermove', onMove)
      els.lyric.removeEventListener('pointerup', onUp)
      els.lyric.removeEventListener('pointercancel', onUp)
      els.lyric.classList.remove('dragging')
      if (dragging) {
        saveFloatPos()
        showToast('歌词已拖出', 'ok', '拖动底部把手调整位置，右上角按钮可锁定 / 收回')
      } else if (state.link !== 'down') {
        openLyricView()
      }
    }
    els.lyric.addEventListener('pointermove', onMove)
    els.lyric.addEventListener('pointerup', onUp)
    els.lyric.addEventListener('pointercancel', onUp)
  })

  /* 浮层把手：拖动移动；松手落在面板上 = 收回（DL-03） */
  els.flHandle.addEventListener('pointerdown', e => {
    if (settings.floatLocked) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    const originX = floatPos.x || 0
    const originY = floatPos.y || 0
    let moved = false
    try { els.flHandle.setPointerCapture(e.pointerId) } catch (err) { /* 忽略 */ }

    const onMove = ev => {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      if (!moved && Math.abs(dx) + Math.abs(dy) > 3) {
        moved = true
        els.float.classList.add('dragging')
      }
      if (!moved) return
      floatPos.x = originX + dx
      floatPos.y = originY + dy
      clampFloatPos()
      applyFloatPos()
    }
    const onUp = ev => {
      els.flHandle.removeEventListener('pointermove', onMove)
      els.flHandle.removeEventListener('pointerup', onUp)
      els.flHandle.removeEventListener('pointercancel', onUp)
      els.float.classList.remove('dragging')
      if (!moved) return
      if (overPanel(ev.clientX, ev.clientY)) retractFloat()
      else saveFloatPos()
    }
    els.flHandle.addEventListener('pointermove', onMove)
    els.flHandle.addEventListener('pointerup', onUp)
    els.flHandle.addEventListener('pointercancel', onUp)
  })

  /* ============================================================
   * 搜索（第六部分：收起式 + 列出候选）
   * ============================================================ */
  function renderSearch() {
    const on = search.open
    els.sbox.hidden = !on
    if (!on) {
      els.slist.hidden = true
      els.shrow.hidden = true
      return
    }
    const q = (els.sq.value || '').trim()
    const showList = search.loading || !!search.error || search.results.length > 0
    els.slist.hidden = !showList
    if (showList) {
      if (search.loading) {
        els.slist.innerHTML = '<div class="sempty">搜索中…</div>'
      } else if (search.error) {
        els.slist.innerHTML = '<div class="sempty">' + esc(search.error) + '</div>'
      } else {
        els.slist.innerHTML = search.results.map((r, i) =>
          '<div class="sitem" data-act="pick" data-i="' + i + '">' +
            '<span class="sn" title="' + esc(r.name) + '">' + esc(r.name) + '</span>' +
            '<span class="ss">' + esc([r.singer, r.album].filter(Boolean).join(' · ')) + '</span>' +
            (r.dur ? '<span class="sd">' + fmtTime(r.dur) + '</span>' : '') +
          '</div>'
        ).join('')
        els.slist.scrollTop = 0
      }
    }
    const showHist = !showList && !q && search.hist.length > 0
    els.shrow.hidden = !showHist
    if (showHist) {
      els.shrow.innerHTML = '<div class="sh-t">最近搜索</div>' + search.hist.map((h, i) =>
        '<button class="schip" type="button" data-act="hist" data-h="' + i + '">' + esc(h) + '</button>'
      ).join('')
    }
    if (state.panelOpen) positionPanel()
  }

  function openSearch() {
    search.open = true
    state.searchOpen = true
    renderSearch()
    els.sq.focus()
  }

  function closeSearch() {
    if (!search.open) return
    search.open = false
    state.searchOpen = false
    search.results = []
    search.error = ''
    search.loading = false
    els.sq.value = ''
    renderSearch()
  }

  function doSearchInput() {
    const q = (els.sq.value || '').trim()
    if (!q) {
      els.sq.focus()
      return
    }
    void runSearch(q)
  }

  /* ============================================================
   * 设置面板渲染
   * ============================================================ */
  const POLL_OPTS = [[500, '0.5s'], [1000, '1s'], [2000, '2s'], [3000, '3s'], [5000, '5s']]
  const FONT_OPTS = [['sm', '小'], ['md', '中'], ['lg', '大']]

  function segHtml(items, cur, attr) {
    return items.map(it =>
      '<button type="button" data-' + attr + '="' + it[0] + '"' +
      (String(it[0]) === String(cur) ? ' class="on"' : '') + '>' + it[1] + '</button>'
    ).join('')
  }

  function renderSettings() {
    els.segPoll.innerHTML = segHtml(POLL_OPTS, settings.poll, 'poll')
    els.segFont.innerHTML = segHtml(FONT_OPTS, settings.floatFont, 'font')
    els.sseSw.classList.toggle('on', !!settings.sse)
    els.lockSw.classList.toggle('on', !!settings.floatLocked)
    els.rng.value = String(Math.round(settings.floatOpacity * 100))
    els.port.value = String(state.port)
  }

  /* ============================================================
   * Toast
   * ============================================================ */
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

  /* ============================================================
   * 歌词页内跳转
   * ============================================================ */
  function seekTo(t) {
    const secs = clamp(Math.round(t), 0, Math.floor(state.status.duration || 0))
    hold('progress', HOLD.progress)
    state.status.progress = secs
    state.syncAt = performance.now()
    renderProgress(secs)
    apiCmd('/seek?offset=' + secs, T_CMD).then(() => refreshSoon(400)).catch(e => {
      if (!e.httpStatus) netFail()
      render()
    })
  }

  /* ============================================================
   * 交互：球 / 面板 / 浮层 / 菜单
   * ============================================================ */
  function togglePlay(btn) {
    if (state.link !== 'ok') return
    const playing = state.status.status === 'playing'
    hold('status', HOLD.status)
    state.status.status = playing ? 'paused' : 'playing'
    renderPlayBtn()
    renderConn() // 悬浮球形态立即跟随（乐观更新）
    cmd(playing ? '/pause' : '/play', playing ? '暂停' : '播放', btn)
  }

  function retryConn() {
    state.link = 'check'
    state.checkAt = Date.now()
    cache.addr = null
    render()
    schedulePoll(0)
    showToast('正在重试连接…')
  }

  shadow.addEventListener('click', e => {
    const fl = e.target && e.target.closest ? e.target.closest('[data-fl]') : null
    if (fl) {
      const act = fl.getAttribute('data-fl')
      if (act === 'lock') {
        settings.floatLocked = !settings.floatLocked
        store.set('lyric-locked', settings.floatLocked)
        applyFloatLock()
      } else if (act === 'retract') {
        retractFloat()
      }
      return
    }

    const pollBtn = e.target.closest('[data-poll]')
    if (pollBtn) {
      settings.poll = clamp(parseInt(pollBtn.getAttribute('data-poll'), 10) || DEFAULTS.poll, 500, 5000)
      store.set('poll', settings.poll)
      renderSettings()
      schedulePoll(0)
      return
    }
    const fontBtn = e.target.closest('[data-font]')
    if (fontBtn) {
      settings.floatFont = fontBtn.getAttribute('data-font')
      store.set('lyric-font-size', settings.floatFont)
      renderSettings()
      applyFloatStyle()
      return
    }

    const target = e.target.closest ? e.target.closest('[data-act]') : null
    if (!target) return
    const act = target.getAttribute('data-act')
    switch (act) {
      case 'toggle':
        if (cooling('toggle')) break
        togglePlay(target)
        break
      case 'prev':
        if (state.link !== 'ok') return
        cmd('/skip-prev', '上一首', target)
        break
      case 'next':
        if (state.link !== 'ok') return
        cmd('/skip-next', '下一首', target)
        break
      case 'collect': {
        if (state.link !== 'ok' || !state.status.name || cooling('collect')) return
        const collected = !!state.status.collect
        hold('collect', HOLD.collect)
        state.status.collect = !collected
        renderSong()
        cmd(collected ? '/uncollect' : '/collect', collected ? '取消收藏' : '收藏', target).then(ok => {
          if (ok) showToast(collected ? '已取消收藏' : '已收藏')
        })
        break
      }
      case 'mute': {
        if (state.link !== 'ok' || cooling('mute')) return
        const next = !state.status.mute
        hold('mute', HOLD.mute)
        state.status.mute = next
        renderVolume()
        cmd('/mute?mute=' + (next ? 'true' : 'false'), next ? '静音' : '取消静音', target)
        break
      }
      case 'retry':
        retryConn()
        break
      case 'settings': {
        const show = els.setbox.hidden
        els.setbox.hidden = !show
        if (show) renderSettings()
        if (state.panelOpen) positionPanel()
        break
      }
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
        state.link = 'check'
        state.checkAt = Date.now()
        render()
        showToast('已切换端口 ' + num + '，正在重连…')
        schedulePoll(0)
        break
      }
      case 'toggle-sse': {
        settings.sse = !settings.sse
        store.set('sse', settings.sse)
        renderSettings()
        if (settings.sse) {
          sse.enabled = true
          sse.errors = 0
          startSSE()
          showToast('已启用 SSE 实时推送')
        } else {
          stopSSE(true)
          showToast('已关闭 SSE，改用轮询')
        }
        break
      }
      case 'toggle-lock': {
        settings.floatLocked = !settings.floatLocked
        store.set('lyric-locked', settings.floatLocked)
        applyFloatLock()
        break
      }
      case 'reset-pos': {
        defaultBallPos()
        applyBallPos()
        saveBallPos()
        defaultFloatPos()
        applyFloatPos()
        saveFloatPos()
        if (state.panelOpen) positionPanel()
        showToast('球与浮层位置已重置')
        break
      }
      case 'open-list': {
        const raw = (els.listIn.value || '').trim()
        const m = raw.match(/^(kw|kg|tx|wy|mg)\s*[:/]\s*(\S+)$/i)
        if (!m) {
          showToast('格式：来源:ID，例如 wy:3778678', 'err', '来源可取 kw / kg / tx / wy / mg')
          return
        }
        openScheme('lxmusic://songlist/open?data=' +
          encodeURIComponent(JSON.stringify({ source: m[1].toLowerCase(), id: m[2] })))
        showToast('已请求 LX Music 打开歌单', 'ok', '若没反应，请确认客户端已安装并注册了 lxmusic:// 协议')
        break
      }
      case 'defaults': {
        settings.poll = DEFAULTS.poll
        settings.sse = DEFAULTS.sse
        settings.floatOpacity = DEFAULTS.floatOpacity
        settings.floatFont = DEFAULTS.floatFont
        settings.floatLocked = false
        store.set('poll', settings.poll)
        store.set('sse', settings.sse)
        store.set('lyric-opacity', settings.floatOpacity)
        store.set('lyric-font-size', settings.floatFont)
        store.set('lyric-locked', false)
        renderSettings()
        applyFloatStyle()
        applyFloatLock()
        if (settings.sse) {
          sse.enabled = true
          sse.errors = 0
          startSSE()
        } else {
          stopSSE(true)
        }
        schedulePoll(0)
        showToast('已恢复默认设置')
        break
      }
      case 'lv-back':
        closeLyricView()
        break
      case 'seek-line': {
        if (state.link !== 'ok') return
        const t = parseFloat(target.getAttribute('data-t'))
        if (!isFinite(t)) return
        seekTo(t)
        showToast('已跳转到 ' + fmtTime(t))
        break
      }
      case 'search-toggle':
        if (search.open) closeSearch()
        else openSearch()
        break
      case 'search-go':
        doSearchInput()
        break
      case 'pick': {
        const item = search.results[parseInt(target.getAttribute('data-i'), 10)]
        if (!item) return
        pushHistory(search.q)
        searchPlay(item)
        closeSearch()
        break
      }
      case 'hist': {
        const q = search.hist[parseInt(target.getAttribute('data-h'), 10)]
        if (!q) return
        els.sq.value = q
        void runSearch(q)
        break
      }
      case 'm-toggle':
        if (cooling('toggle')) break
        closeMenu()
        togglePlay(target)
        break
      case 'm-prev':
        closeMenu()
        if (state.link === 'ok') cmd('/skip-prev', '上一首', target)
        break
      case 'm-next':
        closeMenu()
        if (state.link === 'ok') cmd('/skip-next', '下一首', target)
        break
      case 'm-retry':
        closeMenu()
        retryConn()
        break
      case 'm-hide':
        closeMenu()
        void setVisible(false)
        break
      default:
        break
    }
  })

  els.sq.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault()
      doSearchInput()
    }
  })

  els.sq.addEventListener('input', () => {
    if (!(els.sq.value || '').trim()) {
      search.results = []
      search.error = ''
      renderSearch()
    }
  })

  els.rng.addEventListener('input', () => {
    settings.floatOpacity = clamp(parseInt(els.rng.value, 10) / 100, 0.4, 1)
    applyFloatStyle()
  })
  els.rng.addEventListener('change', () => {
    store.set('lyric-opacity', settings.floatOpacity)
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

  /* 点击面板外：收起面板 / 菜单 */
  document.addEventListener('pointerdown', e => {
    const path = e.composedPath ? e.composedPath() : []
    if (path.indexOf(host) >= 0 || path.indexOf(shadow) >= 0) return
    closeMenu()
    if (state.panelOpen) closePanel()
  }, true)

  /* 键盘：Alt+L 显隐悬浮球；Alt 临时交互浮层；Esc 逐层收起 */
  document.addEventListener('keydown', e => {
    if (e.key === 'Alt') {
      els.float.classList.add('alt')
      return
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'l' || e.key === 'L')) {
      e.preventDefault()
      e.stopPropagation()
      void setVisible(ballHidden)
      return
    }
    if (e.key !== 'Escape') return
    if (!els.menu.hidden) {
      closeMenu()
      e.stopPropagation()
    } else if (search.open) {
      closeSearch()
      e.stopPropagation()
    } else if (state.lyricView) {
      closeLyricView()
      e.stopPropagation()
    } else if (state.panelOpen) {
      closePanel()
      e.stopPropagation()
    }
  }, true)

  document.addEventListener('keyup', e => {
    if (e.key === 'Alt') els.float.classList.remove('alt')
  }, true)

  window.addEventListener('resize', () => {
    clampBallPos()
    applyBallPos()
    if (state.panelOpen) positionPanel()
    if (state.floatDetached) {
      clampFloatPos()
      applyFloatPos()
    }
  })

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) schedulePoll(0)
  })

  /* ============================================================
   * 显隐与脚本菜单
   * ============================================================ */
  function stopNetworking() {
    clearTimeout(pollTimer)
    stopSSE(false)
  }

  function startNetworking() {
    schedulePoll(0)
    if (settings.sse) startSSE()
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
      showToast('悬浮球已隐藏', 'ok', '可从脚本菜单重新显示（快捷键 Alt+L）')
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

  /* ============================================================
   * 启动
   * ============================================================ */
  async function boot() {
    // 端口：允许在设置里修改（LX 设置里可能改过默认端口）
    const savedPort = parseInt(await store.get('port', DEFAULT_PORT), 10)
    if (savedPort >= 1 && savedPort <= 65535) {
      state.port = savedPort
      state.base = 'http://' + API_HOST + ':' + savedPort
    }

    // 设置项
    const sp = parseInt(await store.get('poll', DEFAULTS.poll), 10)
    if (sp >= 500 && sp <= 5000) settings.poll = sp
    settings.sse = !!(await store.get('sse', DEFAULTS.sse))
    const op = parseFloat(await store.get('lyric-opacity', DEFAULTS.floatOpacity))
    if (op >= 0.4 && op <= 1) settings.floatOpacity = op
    const ff = await store.get('lyric-font-size', DEFAULTS.floatFont)
    if (ff === 'sm' || ff === 'md' || ff === 'lg') settings.floatFont = ff
    settings.floatLocked = !!(await store.get('lyric-locked', false))

    // 搜索历史
    const hist = await store.get('search-hist', [])
    if (Array.isArray(hist)) {
      search.hist = hist.filter(x => typeof x === 'string' && x).slice(0, HIST_MAX)
    }

    // 歌词浮层：位置与开关
    state.floatDetached = !!(await store.get('lyric-detached', false))
    const fpos = await store.get('lyric-pos', null)
    if (fpos && typeof fpos.x === 'number' && typeof fpos.y === 'number') {
      floatPos.x = fpos.x
      floatPos.y = fpos.y
    }

    // 悬浮球位置：历史坐标按当前视口重新校正（换屏、改分辨率后不会飞出去）
    const bpos = await store.get('ball-pos', null)
    if (bpos && typeof bpos.x === 'number' && typeof bpos.y === 'number') {
      ballPos.x = bpos.x
      ballPos.y = bpos.y
    } else {
      defaultBallPos()
    }
    clampBallPos()

    registerMenu()

    ballHidden = !!(await store.get('hidden', false))
    if (ballHidden) return

    await whenReady()
    document.documentElement.appendChild(host)
    applyBallPos()
    applyFloatStyle()
    applyFloatLock()
    renderConn()
    renderSettings()
    renderSearch()
    if (state.floatDetached) {
      renderFloat()
      applyFloatPos()
    }

    if (await store.get('panel-open', false)) openPanel(true)

    await fetchStatus()
    render()
    startNetworking()
  }

  void boot()
})()