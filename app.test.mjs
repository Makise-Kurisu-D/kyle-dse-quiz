import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
// Synthetic fixtures contain no examination material; the live bank stays private.
const data = 'window.QUIZ_DATA = ' + JSON.stringify({ subjects: {
  chem: { name: '化學', topics: [{ code: 'T3', name: '示例課題' }], items: [
    { id: 'example-mc', kind: 'mc', topic: 'T3', year: '2022', paper: '卷一', qref: '示例 1', stem: '示例題', correctOpt: 'A', img: 'images/chem-2022-mc-01.jpg' }
  ] }, bio: { name: '生物', topics: [], items: [] }
} });
function boot(hash = '', fetch = async () => { throw new Error('offline'); }, initialStorage = {}, privateBank = false) {
  const nodes = new Map(), events = {}, timers = [], saved = new Map(Object.entries(initialStorage));
  function node(selector) {
    if (!nodes.has(selector)) nodes.set(selector, {
      innerHTML: '', textContent: '', hidden: false, listeners: {},
      classList: { toggle() {}, add() {}, remove() {} },
      addEventListener(type, fn) { this.listeners[type] = fn; },
      querySelector: node, querySelectorAll: () => [],
    });
    return nodes.get(selector);
  }
  const location = { hash, pathname: '/kyle-dse-quiz/', search: '', href: 'original-page' };
  const context = {
    console, AbortController, fetch, location,
    document: { querySelector: node, querySelectorAll: () => [], addEventListener() {} },
    localStorage: { getItem: k => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v), removeItem: k => saved.delete(k) },
    history: { replaceState(_, __, url) { location.hash = url.slice(url.indexOf('#')); } },
    setTimeout(fn, delay) { timers.push({ fn, delay }); return timers.length; },
    clearTimeout() {}, setInterval() {}, clearInterval() {},
    scrollTo() {}, addEventListener(type, fn) { events[type] = fn; },
    QUIZ_SYNC_API: 'https://sync.example.workers.dev', QUIZ_PRIVATE_BANK: privateBank,
    URL, Blob,
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(data, context);
  vm.runInContext(source, context);
  return { context, location, nodes, node, saved, timers, events };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('existing correct answers without a review plan do not break startup or OAuth sync', async () => {
  const sessions = [
    { t: 1791510000000, subj: 'chem', topic: 'T3', results: { 'old-mc': { ok: true, marks: 1, tot: 1 } } },
    { t: 1791510100000, subj: 'chem', topic: 'T3', results: { 'old-mc': { ok: true, marks: 1, tot: 1 }, 'old-sub': { ok: true, marks: 3, tot: 3 } } },
  ];
  let backup;
  const app = boot('#/records?sync=connected&handoff=test-handoff', async (url, options) => {
    if (url.endsWith('/auth/exchange')) return { ok: true, json: async () => ({ sessionId: 'test-session' }) };
    if (options.method === 'PUT') backup = JSON.parse(options.body).data;
    return { ok: true, json: async () => options.method === 'GET' ? { data: null } : { savedAt: '2026-10-09T08:00:00Z' } };
  }, { dse_quiz_sessions_v2: JSON.stringify(sessions) });
  assert.match(app.node('#app').innerHTML, /Kyle 嘅錯題本/);
  await settle();
  assert.deepEqual(backup.sessions, sessions);
  assert.equal(backup.reviewPlan['old-mc'].streak, 2);
  assert.equal(backup.reviewPlan['old-sub'].streak, 1);
  assert.equal(backup.reviewPlan['old-sub'].interval, 15);
  assert.match(app.node('#syncStatus').textContent, /已自動同步/);
});

test('fresh visits, restored records and session links all start on the home page', () => {
  for (const hash of ['', '#/records', '#/session/chem/T3']) {
    const app = boot(hash);
    assert.equal(app.location.hash, '#/');
    assert.match(app.node('#app').innerHTML, /Kyle 嘅錯題本/);
    app.location.hash = '#/records?test=1';
    app.events.hashchange();
    assert.match(app.node('#app').innerHTML, /做題記錄/);
    assert.match(app.node('#app').innerHTML, /target="_blank" rel="noopener"/);
    app.node('#syncConnectBtn').listeners.click();
    assert.equal(app.location.href, 'original-page');
  }
});

test('OAuth callback renders home immediately, then exchanges and syncs', async () => {
  const calls = [];
  const app = boot('#/records?sync=connected&handoff=test-handoff', async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/exchange')) return { ok: true, json: async () => ({ sessionId: 'test-session' }) };
    return { ok: true, json: async () => options.method === 'GET' ? { data: null } : { savedAt: '2026-10-09T08:00:00Z' } };
  });
  assert.equal(app.location.hash, '#/');
  assert.match(app.node('#app').innerHTML, /Kyle 嘅錯題本/);
  await settle();
  assert.equal(calls.length, 3);
  assert.equal(JSON.parse(calls[0].options.body).handoff, 'test-handoff');
  assert.equal(app.saved.get('dse_quiz_sync_session_v1'), 'test-session');
  assert.match(app.node('#syncStatus').textContent, /已自動同步/);
});

test('failed authorization and cancelled authorization leave a visible home page', async () => {
  const failed = boot('#/records?handoff=test');
  await settle();
  assert.match(failed.node('#app').innerHTML, /Kyle 嘅錯題本/);
  assert.match(failed.node('#syncStatus').textContent, /连接失败/);
  const cancelled = boot('#/records?sync=cancelled');
  assert.equal(cancelled.location.hash, '#/');
  assert.match(cancelled.node('#syncStatus').textContent, /已取消/);
});

test('stalled authorization times out visibly instead of leaving a blank page', async () => {
  const app = boot('#/records?handoff=test', (_, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  }));
  app.timers.find(timer => timer.delay === 15000).fn();
  await settle();
  assert.match(app.node('#syncStatus').textContent, /逾時/);
  assert.match(app.node('#app').innerHTML, /Kyle 嘅錯題本/);
});

test('private mode never renders the bundled question bank before authentication', () => {
  const app = boot('', undefined, {}, true);
  assert.match(app.node('#app').innerHTML, /連接 GitHub 後/);
  assert.doesNotMatch(app.node('#app').innerHTML, /題在庫/);
  assert.equal(app.saved.get('dse_quiz_sessions_v2'), undefined);
});

test('OAuth loads the private bank without copying questions into persistent storage', async () => {
  const calls = [];
  const app = boot('#/records?handoff=test', async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/exchange')) return { ok: true, json: async () => ({ sessionId: 'test-session' }) };
    if (url.endsWith('/bank')) return { ok: true, json: async () => app.context.QUIZ_DATA };
    return { ok: true, json: async () => ({ data: null }) };
  }, {}, true);
  await settle();
  assert.match(app.node('#app').innerHTML, /題在庫/);
  assert.equal(calls.find(c => c.url.endsWith('/bank')).options.headers.Authorization, 'Bearer test-session');
  assert.ok([...app.saved.keys()].every(key => !key.includes('bank')));
  app.location.hash = '#/records'; app.events.hashchange();
  app.events.storage({ key: 'dse_quiz_sync_session_v1', newValue: null });
  app.saved.delete('dse_quiz_sync_session_v1');
  app.location.hash = '#/practice/chem'; app.events.hashchange();
  assert.match(app.node('#app').innerHTML, /連接 GitHub 後/);
});

test('a denied private bank stays locked while existing records remain intact', async () => {
  const records = [{ t: Date.now(), subj: 'chem', topic: 'T3', results: {} }];
  const app = boot('', async () => ({ ok: false, status: 403 }), {
    dse_quiz_sync_session_v1: 'test-session', dse_quiz_sessions_v2: JSON.stringify(records)
  }, true);
  await settle();
  assert.match(app.node('#app').innerHTML, /未能讀取錯題庫/);
  assert.deepEqual(JSON.parse(app.saved.get('dse_quiz_sessions_v2')), records);
});

test('private images are fetched with authorization and displayed using revocable local URLs', async () => {
  const calls = [], revoked = [];
  const app = boot('', async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/bank')) return { ok: true, json: async () => app.context.QUIZ_DATA };
    return { ok: true, blob: async () => new Blob(['example-image']) };
  }, { dse_quiz_sync_session_v1: 'test-session' }, true);
  app.context.URL = { createObjectURL: () => 'blob:private-test-image', revokeObjectURL: url => revoked.push(url) };
  const img = { getAttribute: () => 'images/chem-2022-mc-01.jpg', src: '' };
  app.context.document.querySelectorAll = selector => selector === 'img[data-bank-image]' ? [img] : [];
  await settle();
  app.location.hash = '#/session/chem/T3'; app.events.hashchange();
  await settle();
  const image = calls.find(call => call.url.includes('/bank/images/'));
  assert.equal(image.options.headers.Authorization, 'Bearer test-session');
  assert.equal(image.options.cache, 'no-store');
  assert.ok(!image.url.includes('test-session'));
  assert.equal(img.src, 'blob:private-test-image');
  app.saved.delete('dse_quiz_sync_session_v1');
  app.events.storage({ key: 'dse_quiz_sync_session_v1', newValue: null });
  assert.deepEqual(revoked, ['blob:private-test-image']);
});
