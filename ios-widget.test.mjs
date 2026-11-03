import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./ios-widget.js', import.meta.url), 'utf8');
class Stack {
  constructor() { this.children = []; }
  addStack() { const child = new Stack(); this.children.push(child); return child; }
  addText(text) { const child = { text }; this.children.push(child); return child; }
  addSpacer() {}
  layoutHorizontally() {}
  layoutVertically() {}
  centerAlignContent() {}
}
class ListWidget extends Stack { setPadding() {} }
class Color { constructor(value) { this.value = value; } }
class Point { constructor(x, y) { this.x = x; this.y = y; } }
async function boot(family, date) {
  let widget, completed = false;
  const context = { Date, ListWidget, Color, Point, LinearGradient: class {},
    Font: { systemFont: size => size, boldSystemFont: size => size },
    config: { widgetFamily: family, runsInWidget: true },
    Script: { setWidget: value => { widget = value; }, complete: () => { completed = true; } }
  };
  vm.createContext(context);
  await vm.runInContext(`(async () => { ${source}\n globalThis.api = { beijingParts, nextRefresh, makeWidget, URLS }; })()`, context);
  return { api: context.api, widget: context.api.makeWidget(new Date(date), family), completed };
}
function flatten(stack) { return [stack, ...(stack.children || []).flatMap(flatten)]; }

test('Beijing date and day/night refresh are independent of device time zone', async () => {
  const { api, completed } = await boot('small', '2026-11-02T16:00:00Z');
  assert.equal(completed, true);
  const p = api.beijingParts(new Date('2026-11-02T16:00:00Z'));
  assert.deepEqual([p.month, p.day, p.weekday, p.hour], [11, 3, '二', 0]);
  assert.equal(api.nextRefresh(new Date('2026-11-02T22:59:59Z')).toISOString(), '2026-11-02T23:00:01.000Z');
  assert.equal(api.nextRefresh(new Date('2026-11-03T11:00:00Z')).toISOString(), '2026-11-03T16:00:01.000Z');
});

test('small and medium widgets link only to the intended public website routes', async () => {
  const small = (await boot('small', '2026-11-03T04:00:00Z')).widget;
  const medium = (await boot('medium', '2026-11-03T04:00:00Z')).widget;
  const base = 'https://makise-kurisu-d.github.io/kyle-dse-quiz/';
  assert.equal(small.url, base + '#/');
  assert.equal(flatten(small).filter(x => x.url).length, 1);
  assert.deepEqual(flatten(medium).filter(x => x.url).map(x => x.url), [
    base + '#/', base + '#/', base + '#/library/books/concepts', base + '#/library/papers', base + '#/records'
  ]);
  const labels = flatten(medium).map(x => x.text).filter(Boolean);
  assert.ok(labels.includes('11 / 3'));
  assert.ok(labels.includes('週二 · 北京時間'));
  assert.ok(labels.includes('選擇題輕練習  ↗'));
  assert.ok(!/Request\s*\(|Keychain|password|localStorage|Authorization/.test(source));
});
