// DSE 錯題本 · Scriptable 中執行一次以登入，再加入中號或大號小組件。
const SITE = 'https://makise-kurisu-d.github.io/kyle-dse-quiz/'
const API = 'https://snowy-cake-a0a7.3355718646.workers.dev'
const ORIGIN = 'https://makise-kurisu-d.github.io'
const KEY = 'dse-widget-session-v2'
const PROFILES = { kyle: ['chem', 'bio', 'math'], yeelam: ['math', 'm2', 'physics'] }
const NAMES = { chem: '化學', bio: '生物', math: '數學', m2: 'M2', physics: '物理' }
const LEVELS = ['U', '1', '2', '3', '4', '5', '5*', '5**']
const DAY = 86400000, OFFSET = 8 * 3600000, ANCHOR = Date.UTC(2026, 9, 4, 16)

function nextCycle(now) { return new Date(ANCHOR + (Math.floor((now.getTime() - ANCHOR) / (14 * DAY)) + 1) * 14 * DAY) }
function beijingDate(date) {
  const d = new Date(date.getTime() + OFFSET)
  return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' 00:00'
}
function grade(a) {
  if (!a || !Number.isInteger(a.earned) || !Number.isInteger(a.total) || a.total <= 0 || a.earned < 0 || a.earned > a.total) return null
  const percent = 100 * a.earned / a.total
  let best = null, threshold = -1
  for (const b of Array.isArray(a.boundaries) ? a.boundaries : []) {
    if (b && LEVELS.includes(b.level) && Number.isFinite(b.minimumPercent) && b.minimumPercent >= 0 && b.minimumPercent <= 100 && b.minimumPercent <= percent + 1e-9 && b.minimumPercent > threshold) {
      threshold = b.minimumPercent; best = b.level
    }
  }
  return { percent, level: best }
}
function summarize(account, bank, catalog) {
  if (!PROFILES[account] || !bank || !bank.subjects || !catalog || !catalog.subjects) throw new Error('資料格式有誤')
  return PROFILES[account].map(code => {
    const subject = bank.subjects[code]
    if (subject && !Array.isArray(subject.items)) throw new Error('題庫格式有誤')
    if (!subject && !['math', 'm2', 'physics'].includes(code)) throw new Error('題庫缺少科目')
    // entries include distinct same-year papers. Legacy catalog.papers is used only when entries are absent.
    const papers = Array.isArray(catalog.entries) ? catalog.entries.filter(e => e.subject === code) :
      Object.keys((catalog.papers || {})[code] || {}).map(year => ({ year, ...(catalog.papers[code][year] || {}) }))
    const results = papers.map(p => ({ year: p.year, paperId: p.paper_id || '', title: p.title || p.year, result: grade(p.assessment) })).filter(p => p.result)
    const average = results.length ? results.reduce((sum, p) => sum + p.result.percent, 0) / results.length : null
    const levels = results.map(p => String(p.year).slice(-2) + (p.paperId ? '·' + p.paperId : '') + ':' + (p.result.level || '—'))
    return { code, name: NAMES[code], count: subject ? subject.items.length : 0, average, levels, papers: results.length }
  })
}
async function request(path, method, session, body) {
  const req = new Request(API + path)
  req.method = method
  req.headers = { Origin: ORIGIN, 'Content-Type': 'application/json' }
  if (session) req.headers.Authorization = 'Bearer ' + session
  if (body) req.body = JSON.stringify(body)
  req.timeoutInterval = 25
  const result = await req.loadJSON()
  const status = req.response.statusCode
  if (status < 200 || status >= 300) throw new Error(status === 401 ? '登入已失效，請到 Scriptable 重新登入' : '資料暫未能讀取（' + status + '）')
  return result
}
function savedSession() {
  try { const value = JSON.parse(Keychain.get(KEY)); return value && PROFILES[value.user] && typeof value.session === 'string' ? value : null } catch (_) { return null }
}
async function readData(session) {
  const data = await Promise.all([request('/bank', 'GET', session.session), request('/papers/catalog', 'GET', session.session)])
  return summarize(session.user, data[0], data[1])
}
async function signIn() {
  const alert = new Alert()
  alert.title = '登入錯題本小組件'
  alert.message = '輸入網站帳號和密碼。密碼只用於本次登入；會話儲存在 iPhone 鑰匙圈。'
  alert.addTextField('Kyle 或 Yeelam')
  alert.addSecureTextField('網站密碼')
  alert.addAction('登入')
  alert.addCancelAction('取消')
  if (await alert.presentAlert() !== 0) return null
  const username = alert.textFieldValue(0).trim().toLowerCase(), password = alert.textFieldValue(1)
  if (!PROFILES[username] || !password) throw new Error('請輸入 Kyle 或 Yeelam 的帳號及密碼')
  const result = await request('/auth/password', 'POST', null, { username, password })
  if (result.userId !== username || !/^[A-Za-z0-9_-]{40,80}$/.test(result.sessionId || '')) throw new Error('登入回應無效')
  const value = { user: username, session: result.sessionId }
  // Only replace an existing account after the new credentials have succeeded.
  Keychain.set(KEY, JSON.stringify(value))
  return value
}
function text(stack, value, size, color, bold) {
  const t = stack.addText(value); t.font = bold ? Font.boldSystemFont(size) : Font.systemFont(size)
  t.textColor = new Color(color); t.lineLimit = 1; t.minimumScaleFactor = 0.7; return t
}
function makeWidget(now, family, session, rows, error) {
  const widget = new ListWidget(); widget.setPadding(14, 15, 14, 15)
  const hour = new Date(now.getTime() + OFFSET).getUTCHours(), day = hour >= 7 && hour < 19
  const gradient = new LinearGradient(); gradient.colors = [new Color(day ? '#163D71' : '#552C54'), new Color(day ? '#071A38' : '#16172E')]
  gradient.locations = [0, 1]; gradient.startPoint = new Point(0, 0); gradient.endPoint = new Point(1, 1); widget.backgroundGradient = gradient
  widget.url = SITE + '#/'
  widget.refreshAfterDate = new Date(now.getTime() + 30 * 60000)
  const header = widget.addStack(); header.centerAlignContent()
  text(header, 'DSE / ' + (session ? session.user.toUpperCase() : '錯題本'), 11, '#FFFFFF', true); header.addSpacer()
  text(header, '↗', 13, '#FFCB72', true)
  widget.addSpacer(6)
  if (family === 'small') {
    text(widget, '請選中號或大號', 13, '#FFFFFF', true); widget.addSpacer(5)
    text(widget, '顯示三科成績與錯題', 10, '#B7CAE0', false)
  } else if (!rows) {
    text(widget, error || '請在 Scriptable 內登入', 12, '#FFFFFF', true)
    widget.addSpacer(5); text(widget, '登入後顯示私人學習資料', 10, '#B7CAE0', false)
  } else {
    for (const row of rows) {
      const line = widget.addStack(); line.centerAlignContent()
      text(line, row.name, 12, '#FFFFFF', true); line.addSpacer()
      text(line, row.average == null ? '均分 —' : '均分 ' + row.average.toFixed(1) + '%', 11, '#FFFFFF', true)
      line.addSpacer(8); text(line, '錯題 ' + row.count, 11, '#FFCB72', true)
      widget.addSpacer(1)
      const levels = row.levels.length ? row.levels.join('  ') : '暫無原卷成績'
      const detail = text(widget, '每卷 LV  ' + levels, 9, '#C7D5E5', false)
      detail.lineLimit = family === 'large' ? 2 : 1
      widget.addSpacer(family === 'large' ? 12 : 4)
    }
    widget.addSpacer()
    text(widget, '下次雙週重算  ' + beijingDate(nextCycle(now)) + ' 北京時間', 9, '#C7D5E5', false)
    widget.addSpacer(2)
    text(widget, 'LV 為每卷非官方估算 · 均分按卷等權', 8, '#AEBFD2', false)
  }
  return widget
}
async function run() {
  let session = savedSession(), rows = null, error = ''
  if (config.runsInApp) {
    const menu = new Alert(); menu.title = 'DSE 錯題本'; menu.message = session ? '目前帳號：' + session.user : '登入後，小組件才能讀取你的私人資料。'
    menu.addAction(session ? '切換／重新登入' : '登入'); if (session) { menu.addAction('預覽中號'); menu.addDestructiveAction('退出小組件登入') }
    menu.addCancelAction('取消')
    const choice = await menu.presentAlert()
    if (choice === 0) { try { session = await signIn() || session } catch (e) { const a = new Alert(); a.title = '登入未完成'; a.message = String(e.message || e); a.addAction('好'); await a.presentAlert(); return } }
    else if (session && choice === 2) { Keychain.remove(KEY); return }
    else if (choice < 0) return
  }
  if (session) { try { rows = await readData(session) } catch (e) { error = String(e.message || e) } }
  const widget = makeWidget(new Date(), config.widgetFamily || 'medium', session, rows, error)
  if (config.runsInWidget) Script.setWidget(widget); else await widget.presentMedium()
}
await run()
Script.complete()
