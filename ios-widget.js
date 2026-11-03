// DSE 錯題本 iOS 小組件 · 在 Scriptable 中儲存為「DSE 錯題本」
// 小號打開學習主頁；中號另有概念、批改卷及記錄入口。不讀取私人資料。
const SITE = 'https://makise-kurisu-d.github.io/kyle-dse-quiz/'
const URLS = {
  home: SITE + '#/',
  concepts: SITE + '#/library/books/concepts',
  papers: SITE + '#/library/papers',
  records: SITE + '#/records'
}

// 北京時間固定為 UTC+8，與手機目前所在地的時區無關。
function beijingParts(now) {
  const d = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  return { month: d.getUTCMonth() + 1, day: d.getUTCDate(), weekday: '日一二三四五六'[d.getUTCDay()], hour: d.getUTCHours() }
}
function nextRefresh(now) {
  const offset = 8 * 60 * 60 * 1000
  const local = new Date(now.getTime() + offset)
  const dayStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - offset
  const next = [dayStart + 7 * 3600000, dayStart + 19 * 3600000, dayStart + 24 * 3600000]
    .find(t => t > now.getTime())
  return new Date(next + 1000)
}
function label(stack, text, size, color, bold) {
  const t = stack.addText(text)
  t.font = bold ? Font.boldSystemFont(size) : Font.systemFont(size)
  t.textColor = new Color(color)
  t.lineLimit = 1
  t.minimumScaleFactor = 0.75
  return t
}
function action(parent, title, subtitle, url, colors) {
  const row = parent.addStack()
  row.layoutHorizontally()
  row.centerAlignContent()
  row.url = url
  const words = row.addStack()
  words.layoutVertically()
  label(words, title, 13, colors.text, true)
  words.addSpacer(2)
  label(words, subtitle, 9, colors.muted, false)
  row.addSpacer()
  label(row, '↗', 14, colors.accent, true)
  return row
}
function makeWidget(now, family) {
  const date = beijingParts(now)
  const day = date.hour >= 7 && date.hour < 19
  const colors = day
    ? { top: '#163D71', bottom: '#071A38', text: '#FFFFFF', muted: '#B7CAE0', accent: '#FFCB72' }
    : { top: '#552C54', bottom: '#16172E', text: '#FFFFFF', muted: '#D0BFD2', accent: '#FFBE96' }
  const widget = new ListWidget()
  widget.setPadding(16, 16, 16, 16)
  const gradient = new LinearGradient()
  gradient.colors = [new Color(colors.top), new Color(colors.bottom)]
  gradient.locations = [0, 1]
  gradient.startPoint = new Point(0, 0)
  gradient.endPoint = new Point(1, 1)
  widget.backgroundGradient = gradient
  widget.url = URLS.home
  widget.refreshAfterDate = nextRefresh(now)
  const header = widget.addStack()
  header.centerAlignContent()
  label(header, 'DSE / 錯題本', 10, colors.muted, true)
  header.addSpacer()
  label(header, '↗', 13, colors.accent, true)
  widget.addSpacer(7)
  const body = widget.addStack()
  body.layoutHorizontally()
  const left = body.addStack()
  left.layoutVertically()
  label(left, date.month + ' / ' + date.day, 25, colors.text, true)
  left.addSpacer(2)
  label(left, '週' + date.weekday + ' · 北京時間', 10, colors.muted, false)
  left.addSpacer()
  label(left, '今日複習', 16, colors.text, true)
  left.addSpacer(3)
  label(left, '選擇題輕練習  ↗', 11, colors.accent, true)
  if (family !== 'small') {
    left.url = URLS.home
    body.addSpacer(18)
    const right = body.addStack()
    right.layoutVertically()
    right.addSpacer(1)
    action(right, '概念回顧', '按課題溫習', URLS.concepts, colors)
    right.addSpacer()
    action(right, '批改卷', '回看原卷批注', URLS.papers, colors)
    right.addSpacer()
    action(right, '學習記錄', '查看複習進度', URLS.records, colors)
    right.addSpacer(1)
  }
  return widget
}

const widget = makeWidget(new Date(), config.widgetFamily || 'medium')
if (config.runsInWidget) {
  Script.setWidget(widget)
} else {
  await widget.presentMedium()
}
Script.complete()
