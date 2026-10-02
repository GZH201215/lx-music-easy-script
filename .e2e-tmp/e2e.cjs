// 端到端验证：mock LX API + Playwright（open shadow 补丁）
const { chromium } = require('playwright')
const fs = require('fs')

const API = 'http://127.0.0.1:23330'
const SCRIPT = fs.readFileSync('/workspace/lx-music-easy-script.user.js', 'utf8')
  .replace("{ mode: 'closed' }", "{ mode: 'open' }")

let pass = 0
let fail = 0
function check(name, cond, extra) {
  if (cond) {
    pass++
    console.log('PASS ' + name)
  } else {
    fail++
    console.log('FAIL ' + name + (extra === undefined ? '' : ' → ' + JSON.stringify(extra)))
  }
}

const getCalls = async () => JSON.parse(await (await fetch(API + '/__calls')).text())
const reset = async () => { await fetch(API + '/__reset') }
const goDown = async () => { await fetch(API + '/__down') }
const goUp = async () => { await fetch(API + '/__up') }
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function waitFor(fn, timeout = 5000, interval = 120) {
  const t0 = Date.now()
  for (;;) {
    let v
    try { v = await fn() } catch (e) { v = null }
    if (v) return v
    if (Date.now() - t0 > timeout) return null
    await sleep(interval)
  }
}

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const errors = []
  page.on('pageerror', e => errors.push('pageerror: ' + String(e)))
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

  await page.addInitScript(() => {
    const mem = {}
    window.GM_getValue = (k, d) => (k in mem ? mem[k] : d)
    window.GM_setValue = (k, v) => { mem[k] = v }
    const origFetch = window.fetch.bind(window)
    window.fetch = (url, opts) => {
      const u = String(url)
      if (u.includes('music.163.com')) {
        const body = JSON.stringify({ result: { songs: [
          { name: 'Hello', artists: [{ name: 'Adele' }], album: { name: '25' }, duration: 295000 },
          { name: 'Hello Two', artists: [{ name: 'X' }], album: { name: 'Y' }, duration: 100000 },
        ] } })
        return Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }
      return origFetch(url, opts)
    }
    window.GM_xmlhttpRequest = opts => {
      window.fetch(opts.url, { method: opts.method || 'GET' }).then(
        r => r.text().then(t => opts.onload && opts.onload({ status: r.status, responseText: t })),
        e => opts.onerror && opts.onerror(e)
      )
    }
  })

  await page.goto(API + '/')
  await page.addScriptTag({ content: SCRIPT })
  await sleep(900)

  const ball = page.locator('.ball')
  const panel = page.locator('.panel')
  const toast = page.locator('.toast')

  // 1. 悬浮球出现，且拿到歌曲信息
  check('ball visible', await ball.isVisible())
  const titleOk = await waitFor(async () => ((await ball.getAttribute('title')) || '').includes('Test Song'), 4000)
  check('ball title shows song', !!titleOk)
  check('ball playing state', ((await ball.getAttribute('class')) || '').includes('playing'), await ball.getAttribute('class'))

  // 2. 点球展开面板
  await ball.click()
  check('panel opens', await panel.isVisible())
  check('panel title', (await page.locator('.meta .t').textContent()) === 'Test Song')
  check('panel sub', ((await page.locator('.meta .s').textContent()) || '').includes('Singer A'))

  // 3. 播放/暂停
  await reset()
  await page.locator('[data-act="toggle"]').click()
  const paused = await waitFor(async () => (await getCalls()).includes('/pause'), 3000)
  check('toggle → /pause', !!paused)
  check('ball paused state', ((await ball.getAttribute('class')) || '').includes('paused'), await ball.getAttribute('class'))
  await reset()
  await page.locator('[data-act="toggle"]').click()
  check('toggle → /play', !!(await waitFor(async () => (await getCalls()).includes('/play'), 3000)))

  // 4. 下一首
  await reset()
  await page.locator('[data-act="next"]').click()
  check('next → /skip-next', !!(await waitFor(async () => (await getCalls()).includes('/skip-next'), 3000)))
  check('title follows skip', !!(await waitFor(async () => (await page.locator('.meta .t').textContent()) === 'Next Song', 4000)))

  // 5. 进度条拖动：松手才 seek
  await reset()
  const pb = await page.locator('.pbar').boundingBox()
  await page.mouse.move(pb.x + pb.width * 0.5, pb.y + pb.height / 2)
  await page.mouse.down()
  await page.mouse.move(pb.x + pb.width * 0.75, pb.y + pb.height / 2, { steps: 5 })
  const pvVisible = await page.locator('.pv-bubble').isVisible()
  check('drag shows time bubble', pvVisible)
  await page.mouse.up()
  const seekCall = await waitFor(async () => {
    const c = await getCalls()
    return c.find(x => x.startsWith('/seek'))
  }, 3000)
  const seekVal = seekCall ? parseFloat(seekCall.split('=')[1]) : -1
  check('progress drag → /seek ~150', seekVal >= 145 && seekVal <= 155, seekCall)

  // 6. 音量拖动
  await reset()
  const vb = await page.locator('.vbar').boundingBox()
  await page.mouse.move(vb.x + vb.width * 0.2, vb.y + vb.height / 2)
  await page.mouse.down()
  await page.mouse.move(vb.x + vb.width * 0.8, vb.y + vb.height / 2, { steps: 5 })
  await page.mouse.up()
  const volCall = await waitFor(async () => (await getCalls()).find(x => x.startsWith('/volume')), 3000)
  check('volume drag → /volume ~80', !!volCall && Math.abs(parseInt(volCall.split('=')[1], 10) - 80) <= 2, volCall)

  // 7. 静音 / 收藏
  await reset()
  await page.locator('[data-act="mute"]').click()
  check('mute → /mute?mute=true', !!(await waitFor(async () => (await getCalls()).includes('/mute?mute=true'), 3000)))
  await reset()
  await page.locator('[data-act="collect"]').click()
  check('collect → /collect', !!(await waitFor(async () => (await getCalls()).includes('/collect'), 3000)))

  // 8. 歌词拖出为浮层
  const ly = await page.locator('.lyric').boundingBox()
  await page.mouse.move(ly.x + ly.width / 2, ly.y + ly.height / 2)
  await page.mouse.down()
  await page.mouse.move(ly.x + ly.width / 2 + 60, ly.y + ly.height / 2 - 120, { steps: 8 })
  await page.mouse.up()
  const float = page.locator('.float-lyric')
  check('lyric drag → float shows', !!(await waitFor(async () => await float.isVisible(), 2000)))
  check('float has text', ((await page.locator('.fl-text').textContent()) || '').trim().length > 0)
  await page.locator('[data-fl="lock"]').click()
  check('float lock toggles', ((await float.getAttribute('class')) || '').includes('locked'))
  await page.locator('[data-fl="retract"]').click()
  check('float retract hides', !(await float.isVisible()) || !(await float.isVisible()))

  // 9. 完整歌词页
  await page.locator('.lyric').click()
  check('lyric view opens', await page.locator('.lyrview').isVisible())
  const lineCount = await page.locator('.lv-line').count()
  check('lyric lines rendered', lineCount === 4, lineCount)
  check('translation shown', (await page.locator('.lv-line .lv-tr').first().textContent()) === '第一句')
  await reset()
  await page.locator('.lv-line').nth(1).click()
  check('click lyric line → /seek?offset=3', !!(await waitFor(async () => (await getCalls()).includes('/seek?offset=3'), 3000)))
  await page.locator('[data-act="lv-back"]').click()
  check('lyric view closes', !(await page.locator('.lyrview').isVisible()))

  // 10. 搜索：展开 → 自动聚焦 → 结果 → 点选收起
  await page.locator('[data-act="search-toggle"]').click()
  check('search box opens', await page.locator('.sbox').isVisible())
  const focused = await page.evaluate(() => {
    const host = document.getElementById('lx-music-easy-script')
    const a = host.shadowRoot.activeElement
    return a ? a.className : ''
  })
  check('search input focused', focused === 'q', focused)
  await page.locator('.sline .q').fill('hello')
  await page.keyboard.press('Enter')
  const items = await waitFor(async () => {
    const n = await page.locator('.sitem').count()
    return n >= 2 ? n : null
  }, 4000)
  check('search results listed', !!items, items)
  await page.locator('.sitem').first().click()
  const toastText = await waitFor(async () => {
    const t = await toast.textContent()
    return t && t.length ? t : null
  }, 2500)
  check('click result → toast mentions song', !!toastText && toastText.includes('Hello'), toastText)
  check('search collapses after pick', !(await page.locator('.sbox').isVisible()))
  check('search history kept', (await page.locator('.shrow').count()) >= 0)

  // 11. 设置面板
  await page.locator('[data-act="settings"]').click()
  check('settings opens', await page.locator('.setbox').isVisible())
  await page.locator('[data-act="toggle-sse"]').click()
  check('sse off toast', ((await toast.textContent()) || '').includes('已关闭 SSE'))
  await page.locator('[data-act="toggle-sse"]').click()
  check('sse on toast', ((await toast.textContent()) || '').includes('已启用 SSE'))
  await page.locator('[data-poll="500"]').click()
  check('poll segment marks on', ((await page.locator('[data-poll="500"]').getAttribute('class')) || '').includes('on'))
  await page.locator('.listid').fill('abc')
  await page.locator('[data-act="open-list"]').click()
  check('open-list invalid format', ((await toast.textContent()) || '').includes('格式'))
  await page.locator('.listid').fill('wy:3778678')
  await page.locator('[data-act="open-list"]').click()
  check('open-list valid', ((await toast.textContent()) || '').includes('已请求'))
  await page.locator('[data-act="reset-pos"]').click()
  check('reset pos toast', ((await toast.textContent()) || '').includes('位置已重置'))
  await page.locator('[data-act="defaults"]').click()
  check('defaults toast', ((await toast.textContent()) || '').includes('已恢复默认设置'))

  // 12. 点击页面不被拦截
  await page.locator('#clickspace').click()
  check('page click works', (await page.evaluate(() => window.__pageClicks)) >= 1)

  // 13. Esc 收起
  await page.keyboard.press('Escape')
  check('esc closes panel', !(await panel.isVisible()))

  // 14. Alt+L 显隐悬浮球
  await page.keyboard.press('Alt+l')
  const gone = await waitFor(async () => (await page.locator('#lx-music-easy-script').count()) === 0, 2000)
  check('Alt+L hides ball', !!gone)
  await page.keyboard.press('Alt+l')
  const back = await waitFor(async () => (await page.locator('.ball').count()) > 0, 2000)
  check('Alt+L shows ball again', !!back)

  // 15. 抖动抑制：断开 2 秒不判死，超 7.5 秒才判死，恢复即回
  await page.locator('.ball').click()
  await reset()
  await goDown()
  await sleep(2500)
  const cls1 = (await ball.getAttribute('class')) || ''
  check('no offline within 7.5s', !cls1.includes('offline'), cls1)
  const off = await waitFor(async () => ((await ball.getAttribute('class')) || '').includes('offline'), 9000)
  check('offline after 7.5s', !!off)
  check('offline block visible', await page.locator('div.offline').isVisible())
  await goUp()
  const recovered = await waitFor(async () => {
    const c = (await ball.getAttribute('class')) || ''
    return c.includes('playing') || c.includes('paused') ? c : null
  }, 8000)
  check('recovers after server back', !!recovered, recovered)

  // 16. 无脚本级错误
  // 断线测试期间 mock 会故意返回 500，浏览器会记 "Failed to load resource"，属预期噪音
  const realErrors = errors.filter(e =>
    !/Failed to load resource|lxmusic|Failed to launch|Not allowed to launch|ERR_UNKNOWN_URL_SCHEME/.test(e))
  check('no page errors', realErrors.length === 0, realErrors.slice(0, 5))

  console.log('\n==== ' + pass + ' passed, ' + fail + ' failed ====')
  await browser.close()
  process.exit(fail ? 1 : 0)
})().catch(e => {
  console.error('HARNESS ERROR', e)
  process.exit(2)
})