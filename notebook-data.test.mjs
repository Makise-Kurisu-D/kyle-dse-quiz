import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

// Synthetic records only. Never load a bank, private repository, or real endpoint.
const source = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const publicModules = ['subject-config.js', 'study-experience.js', 'library.js', 'paper-reader.js']
  .map(path => ({ path, source: readFileSync(new URL(path, import.meta.url), 'utf8') }));
const end = source.lastIndexOf('})();');
assert.ok(end >= 0, 'the app must retain its enclosing IIFE');
// Expose internals only in this VM copy; production app.js gains no public API.
const testSource = source.slice(0, end) +
  'window.__notebookData = Object.freeze({ backupData, mergeData, validBackup });\n' + source.slice(end);
const DAY = 864e5, PERIOD = 14 * DAY;
const ANCHOR = Date.UTC(2026, 9, 4, 16);
const CYCLE = ANCHOR + PERIOD, NEXT = CYCLE + PERIOD;
const ID = 'synthetic-math-Q01-exact';
const DKEY = 'math:U1';
const plain = value => JSON.parse(JSON.stringify(value));
const state = data => { const { exportedAt, ...rest } = plain(data); return rest; };
const keyFor = (key, user) => user === 'kyle' ? key : key + ':' + user;
function record(t, id = ID, extra = {}) {
  return { t, subj: 'math', topic: 'U1', results: { [id]: { ok: false, marks: 1, tot: 2,
    attempt: { questionId: id, answer: 'synthetic original answer', submittedAt: t } } }, ...extra };
}
function backup(extra = {}) {
  return { app: 'kyle-dse-quiz', version: 2, userId: 'kyle', sessions: [], archive: [],
    drafts: {}, reviewPlan: {}, aiReviews: {}, cycle: String(CYCLE), ...extra };
}
function plan(at = CYCLE + 100) {
  return { level: 0, interval: 15, lastAt: at, dueAt: at + 15 * DAY,
    ratio: 1, streak: 1, scheduleVersion: 2 };
}
function stored(data, user = data.userId || 'kyle') {
  return Object.fromEntries([
    ['dse_quiz_user_v1', user],
    ...[['dse_quiz_sessions_v2', data.sessions], ['dse_quiz_archive_v1', data.archive],
      ['dse_quiz_draft_v2', data.drafts], ['dse_quiz_review_v1', data.reviewPlan],
      ['dse_quiz_ai_reviews_v1', data.aiReviews]].map(([key, value]) => [keyFor(key, user), JSON.stringify(value)]),
    [keyFor('dse_quiz_cycle_v1', user), data.cycle],
  ].filter(([, value]) => value != null));
}
function boot(t, { hash = '#/', user = 'kyle', now = CYCLE + 1000, initial = {},
  confirm = true, prompt = null } = {}) {
  let clock = now;
  const nodes = new Map(), saved = new Map(Object.entries({ dse_quiz_user_v1: user, ...initial }));
  const events = {}, documentEvents = {}, timers = [], intervals = [], network = [], confirmations = [], prompts = [];
  function node(selector) {
    if (!nodes.has(selector)) nodes.set(selector, {
      innerHTML: '', textContent: '', hidden: false, listeners: {}, dataset: {}, value: '',
      classList: { toggle() {}, add() {}, remove() {} }, style: { setProperty() {} },
      get src() { return this._src; }, set src(value) { this._src = value; if (this.onload) this.onload(); },
      setAttribute(key, value) { this[key] = value; }, getAttribute(key) { return this[key] ?? null; },
      removeAttribute(key) { delete this[key]; }, focus() {}, scrollIntoView() {},
      addEventListener(type, fn) { this.listeners[type] = fn; },
      removeEventListener(type, fn) { if (this.listeners[type] === fn) delete this.listeners[type]; },
      querySelector: node, querySelectorAll: () => [],
      click() { this.listeners.click?.call(this, { target: this }); },
    });
    return nodes.get(selector);
  }
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  class SyntheticFileReader {
    readAsText(file) {
      if (file.error) { this.onerror(); return; }
      this.result = file.contents;
      this.onload();
    }
  }
  const location = { hash, pathname: '/synthetic-notebook/', search: '', reload() {} };
  const context = {
    console, Date: Clock, AbortController, Blob, URL, FileReader: SyntheticFileReader, location,
    document: { querySelector: node, querySelectorAll: () => [], addEventListener(type, fn) {
      (documentEvents[type] ||= []).push(fn);
    } },
    localStorage: { getItem: key => saved.get(key) ?? null,
      setItem: (key, value) => saved.set(key, String(value)), removeItem: key => saved.delete(key) },
    history: { replaceState(_, __, url) { location.hash = url.slice(url.indexOf('#')); } },
    fetch: async (...args) => { network.push(args); throw new Error('Real network is forbidden in notebook-data tests'); },
    setTimeout(fn, delay) { timers.push({ fn, delay }); return timers.length; },
    clearTimeout(id) { if (timers[id - 1]) timers[id - 1].cleared = true; },
    setInterval(fn, delay) { intervals.push({ fn, delay }); return intervals.length; },
    clearInterval(id) { if (intervals[id - 1]) intervals[id - 1].cleared = true; },
    confirm(message) { confirmations.push(message); return confirm; },
    prompt(message) { prompts.push(message); return prompt; },
    scrollTo() {}, addEventListener(type, fn) { events[type] = fn; },
    removeEventListener(type, fn) { if (events[type] === fn) delete events[type]; },
    QUIZ_SYNC_API: '', QUIZ_PRIVATE_BANK: false, QUIZ_PASSWORD_AUTH: false,
    QUIZ_DATA: { subjects: {
      chem: { name: '化學', topics: [], items: [] }, bio: { name: '生物', topics: [], items: [] },
      math: { name: '數學', topics: [{ code: 'U1', name: 'Synthetic unit' }], items: [
        { id: ID, kind: 'mc', topic: 'U1', year: '2026', qref: 'Synthetic Q1', stem: 'Synthetic question', correctOpt: 'A' },
      ] },
    } },
  };
  context.window = context;
  vm.createContext(context);
  for (const module of publicModules) vm.runInContext(module.source, context, { filename: module.path });
  vm.runInContext(testSource, context, { filename: 'app.js (in-memory test copy)' });
  t.after(() => assert.deepEqual(network, [], 'all client data tests must remain offline'));
  const api = context.__notebookData;
  const app = { context, node, saved, events, timers, intervals, confirmations, prompts, api,
    setNow(value) { clock = value; },
    snapshot: () => state(api.backupData()),
    navigate(hash) { location.hash = hash; events.hashchange(); },
    import(value, { error = false } = {}) {
      if (location.hash !== '#/records') app.navigate('#/records');
      const target = { files: [{ contents: typeof value === 'string' ? value : JSON.stringify(value), error }], value: 'synthetic-backup.json' };
      node('#importDataFile').listeners.change({ target });
      return target;
    },
  };
  return app;
}

test('client cycle merge cannot revive archived submissions in either order or on replay', t => {
  const old = record(CYCLE - 1000), atBoundary = record(CYCLE);
  const stale = backup({ cycle: String(ANCHOR), sessions: [old], drafts: { [DKEY]: {
    text: { [ID]: 'stale answer', removed: 'deleted answer' }, changedAt: { ['text:' + ID]: CYCLE - 800, 'text:removed': CYCLE - 700 },
  } }, reviewPlan: { [ID]: plan(CYCLE - 500) } });
  const newer = backup({ sessions: [atBoundary], archive: [plain(old)], drafts: { [DKEY]: {
    text: { [ID]: 'newer unfinished answer' }, steps: { [ID]: { mode: 'text', rows: [] } },
    changedAt: { ['text:' + ID]: CYCLE + 20, ['steps:' + ID]: CYCLE + 21 }, deletedAt: CYCLE + 10,
  } }, reviewPlan: { [ID]: plan(CYCLE + 10) } });
  const originals = plain([stale, newer]);
  for (const [local, remote] of [[stale, newer], [newer, stale]]) {
    // Keep startup in the old cycle so it cannot pre-fix the stale fixture.
    const app = boot(t, { now: ANCHOR + 1, initial: stored(local) });
    assert.equal(app.api.mergeData(remote), true);
    const merged = app.snapshot();
    assert.equal(merged.cycle, String(CYCLE));
    assert.deepEqual(merged.sessions, [atBoundary]);
    assert.deepEqual(merged.archive, [old]);
    assert.deepEqual(Object.keys(merged.archive[0].results), [ID]);
    assert.equal(merged.drafts[DKEY].text[ID], 'newer unfinished answer');
    assert.equal(merged.drafts[DKEY].text.removed, undefined);
    assert.deepEqual(merged.drafts[DKEY].steps[ID], newer.drafts[DKEY].steps[ID]);
    assert.equal(merged.drafts[DKEY].deletedAt, CYCLE + 10);
    assert.deepEqual(merged.reviewPlan[ID], newer.reviewPlan[ID]);
    for (const repeated of [stale, newer, merged, stale, merged]) {
      assert.equal(app.api.mergeData(repeated), true);
      assert.deepEqual(app.snapshot(), merged, 'replayed history and drafts are idempotent');
    }
  }
  assert.deepEqual([stale, newer], originals, 'client merge leaves both input backups intact');
});

test('client partitions all four arrays at the boundary without rewriting evidence or exact identities', t => {
  const before = record(CYCLE - 0.5), boundary = record(CYCLE), future = record(NEXT + 0.25);
  const distinct = record(CYCLE, 'synthetic-math-Q1-exact');
  const app = boot(t, { initial: stored(backup({ sessions: [before, future], archive: [boundary] })) });
  const localFuture = app.api.backupData().sessions[1];
  Object.freeze(localFuture); Object.freeze(localFuture.results);
  const remote = backup({ sessions: [plain(boundary), distinct], archive: [plain(future), plain(before)] });
  const original = plain(remote);
  Object.freeze(remote.sessions); Object.freeze(remote.archive); Object.freeze(remote);
  assert.equal(app.api.mergeData(remote), true);
  const merged = app.snapshot();
  assert.deepEqual(merged.sessions, [boundary, distinct, future]);
  assert.deepEqual(merged.archive, [before]);
  assert.deepEqual(remote, original);
  assert.deepEqual(merged.archive[0].results[ID].attempt, before.results[ID].attempt);
  assert.equal(app.api.backupData().sessions[2], localFuture, 'dedup keeps the first existing local immutable record instead of a later remote copy');
});

test('timeline keeps distinct same-time submissions and renders exact cloud replays only once', t => {
  const firstId = ID, secondId = ID.replace('Q01', 'Q1');
  const first = record(CYCLE + 100, firstId), second = record(CYCLE + 100, secondId);
  first.results[firstId].attempt.version = 1;
  second.results[secondId].attempt.version = 1;
  first.results[firstId].attempt.answer = 'synthetic same-time original one';
  second.results[secondId].attempt.answer = 'synthetic same-time original two';
  const app = boot(t, { hash: '#/records', initial: stored(backup({
    sessions: [first, plain(first), second], archive: [plain(second)],
  })) });
  function assertTimeline() {
    const html = app.node('#app').innerHTML;
    assert.equal((html.match(/<details class="session-entry" /g) || []).length, 2,
      'same timestamp, subject and topic do not collapse distinct result identities');
    assert.equal((html.match(/<details class="attempt-snapshot"/g) || []).length, 2);
    for (const answer of [first.results[firstId].attempt.answer, second.results[secondId].attempt.answer]) {
      assert.equal(html.split(answer).length - 1, 1, 'each exact original answer snapshot renders once');
    }
    for (const id of [firstId, secondId]) assert.ok(html.includes(id), 'exact IDs remain in the original-question or drill links');
  }
  assertTimeline();
  const replay = backup({ sessions: [plain(first), plain(second)], archive: [plain(first), plain(second)] });
  for (let i = 0; i < 2; i++) {
    assert.equal(app.api.mergeData(replay), true);
    app.navigate('#/records');
    assert.equal(app.snapshot().sessions.length, 2);
    assert.deepEqual(app.snapshot().archive, []);
    assertTimeline();
  }
});

test('client without a cycle keeps the existing current and archive placements', t => {
  const current = record(CYCLE + 100), archived = record(CYCLE - 100);
  const app = boot(t, { initial: stored(backup({ sessions: [current], archive: [archived] })) });
  app.saved.delete('dse_quiz_cycle_v1');
  assert.equal(app.api.mergeData(backup({ cycle: null, sessions: [plain(current)], archive: [plain(archived)] })), true);
  assert.equal(app.snapshot().cycle, null);
  assert.deepEqual(app.snapshot().sessions, [current]);
  assert.deepEqual(app.snapshot().archive, [archived]);
});

test('an open-tab timer archives only reports and leaves mounted grading, drafts and review plans intact', t => {
  const old = record(CYCLE + 100), earlier = record(CYCLE - 100), future = record(NEXT);
  const initial = stored(backup({ sessions: [old, future], archive: [earlier],
    drafts: { [DKEY]: { pick: { [ID]: 'A' }, text: {}, paper: {}, changedAt: { ['pick:' + ID]: NEXT - 2000 } } },
    reviewPlan: { [ID]: plan(CYCLE + 100) }, aiReviews: { synthetic: { questionId: ID, confirmedAt: CYCLE + 100 } },
  }));
  const app = boot(t, { now: NEXT - 1000, initial });
  const timer = app.intervals.find(interval => interval.delay === 1000 && !interval.cleared);
  assert.ok(timer, 'the countdown starts while the home page remains open');
  app.navigate('#/session/math/U1');
  app.node('#submitBtn').listeners.click();
  assert.ok(app.saved.has('dse_quiz_pending_review_v1'), 'submission is pending explicit confirmation');
  const preserved = ['dse_quiz_draft_v2', 'dse_quiz_pending_review_v1', 'dse_quiz_review_v1',
    'dse_quiz_task_v1', 'dse_quiz_ai_reviews_v1'].map(key => [key, app.saved.get(key)]);
  const panel = app.node('#resultPanel').innerHTML, saveHandler = app.node('#saveSessionBtn').listeners.click;
  app.setNow(NEXT);
  timer.fn();
  assert.equal(app.saved.get('dse_quiz_cycle_v1'), String(NEXT));
  assert.deepEqual(app.snapshot().sessions, [future]);
  assert.deepEqual(app.snapshot().archive, [earlier, old]);
  for (const [key, value] of preserved) assert.equal(app.saved.get(key), value, key + ' survives rollover byte-for-byte');
  assert.equal(app.node('#resultPanel').innerHTML, panel, 'do not replace active grading DOM');
  assert.equal(app.node('#saveSessionBtn').listeners.click, saveHandler, 'do not rebind or resubmit the pending attempt');
  const after = app.snapshot();
  timer.fn();
  assert.deepEqual(app.snapshot(), after, 'the next countdown tick is a no-op for stored evidence');
});

for (const hash of ['#/records', '#/session/math/U1']) {
  test('a tab opened directly at ' + hash + ' rolls over without first visiting home or regaining focus', t => {
    const old = record(CYCLE + 100);
    const app = boot(t, { hash, now: NEXT - 1000, initial: stored(backup({ sessions: [old],
      drafts: { [DKEY]: { pick: { [ID]: 'A' }, text: {}, paper: {}, changedAt: { ['pick:' + ID]: NEXT - 2000 } } },
      reviewPlan: { [ID]: plan(CYCLE + 100) },
    })) });
    if (hash.startsWith('#/session/')) app.node('#submitBtn').listeners.click();
    const preserved = ['dse_quiz_draft_v2', 'dse_quiz_pending_review_v1', 'dse_quiz_review_v1']
      .map(key => [key, app.saved.get(key)]);
    const page = app.node('#app').innerHTML, panel = app.node('#resultPanel').innerHTML;
    const saveHandler = app.node('#saveSessionBtn').listeners.click;
    if (hash === '#/records') assert.match(page, /data-in-cycle="true"/);
    app.setNow(NEXT);
    // Fire every scheduled interval; no focus or hashchange event is allowed to hide a missing timer.
    app.intervals.filter(interval => !interval.cleared).slice().forEach(interval => interval.fn());
    assert.equal(app.saved.get('dse_quiz_cycle_v1'), String(NEXT), 'direct-entry tabs must advance the stored cycle automatically');
    assert.deepEqual(app.snapshot().sessions, []);
    assert.deepEqual(app.snapshot().archive, [old]);
    for (const [key, value] of preserved) assert.equal(app.saved.get(key), value);
    if (hash === '#/records') {
      assert.match(app.node('#app').innerHTML, /data-in-cycle="false"/, 'records refresh their reporting surface at rollover');
    } else {
      assert.equal(app.node('#app').innerHTML, page, 'direct-entry exercise stays mounted');
      assert.equal(app.node('#resultPanel').innerHTML, panel, 'direct-entry grading stays mounted');
      assert.equal(app.node('#saveSessionBtn').listeners.click, saveHandler, 'pending grading handler is preserved');
    }
    assert.equal(app.intervals.filter(interval => interval.delay === 1000 && !interval.cleared).length, 1);
  });
}

test('validBackup accepts exported shapes and legacy data but rejects malformed nested records', t => {
  const app = boot(t);
  assert.equal(app.api.validBackup(app.api.backupData()), true);
  const valid = backup({ sessions: [record(CYCLE)], drafts: { [DKEY]: {
    text: { [ID]: 'synthetic draft' }, changedAt: { ['text:' + ID]: CYCLE }, deletedAt: 0,
  } } });
  const legacy = plain(valid); delete legacy.userId; legacy.version = 1;
  assert.equal(app.api.validBackup(valid), true);
  assert.equal(app.api.validBackup(legacy), true);
  const invalid = [
    ['wrong app', data => { data.app = 'not-this-app'; }],
    ['unknown owner', data => { data.userId = 'someone-else'; }],
    ['negative time', data => { data.sessions[0].t = -1; }],
    ['nonfinite time', data => { data.sessions[0].t = Infinity; }],
    ['array results', data => { data.sessions[0].results = []; }],
    ['negative marks', data => { data.sessions[0].results[ID].marks = -1; }],
    ['marks exceed total', data => { data.sessions[0].results[ID].marks = 3; }],
    ['zero total', data => { data.sessions[0].results[ID].tot = 0; }],
    ['array attempt', data => { data.sessions[0].results[ID].attempt = []; }],
    ['non-object draft', data => { data.drafts[DKEY] = []; }],
    ['array draft answers', data => { data.drafts[DKEY].text = []; }],
    ['nonfinite changedAt', data => { data.drafts[DKEY].changedAt['text:' + ID] = NaN; }],
    ['negative tombstone', data => { data.drafts[DKEY].deletedAt = -1; }],
    ['invalid plan', data => { data.reviewPlan[ID] = null; }],
    ['invalid AI map', data => { data.aiReviews = []; }],
    ['invalid cycle', data => { data.cycle = 'not-a-time'; }],
    ['prototype key', data => { data.aiReviews = JSON.parse('{"__proto__":{"synthetic":true}}'); }],
    ['nested constructor', data => { data.sessions[0].results[ID].attempt.constructor = {}; }],
  ];
  for (const [label, invalidate] of invalid) {
    const data = plain(valid); invalidate(data);
    assert.equal(app.api.validBackup(data), false, label);
  }
});

test('wrong-owner client merges and imports never mutate either account or create rollback copies', t => {
  for (const user of ['kyle', 'yeelam']) {
    const other = user === 'kyle' ? 'yeelam' : 'kyle';
    const own = backup({ userId: user, sessions: [record(CYCLE + 10)] });
    const wrong = backup({ userId: other, sessions: [record(CYCLE + 20, 'other-account-synthetic')] });
    const app = boot(t, { user, hash: '#/records', initial: { ...stored(own, user),
      [keyFor('dse_quiz_draft_v2', other)]: JSON.stringify({ sentinel: { text: { untouched: 'other account' } } }),
    } });
    assert.equal(app.api.validBackup(wrong), true, 'a valid other-user backup is distinct from a malformed file');
    const before = [...app.saved], beforeState = app.snapshot();
    assert.equal(app.api.mergeData(wrong), false);
    app.import(wrong);
    assert.deepEqual([...app.saved], before);
    assert.deepEqual(app.snapshot(), beforeState);
    assert.deepEqual(app.confirmations, []);
    assert.deepEqual(app.prompts, []);
    assert.match(app.node('#toast').innerHTML, /備份不屬於目前帳戶/);
    assert.equal(app.saved.has(keyFor('dse_quiz_import_rollback_v1', user)), false);
  }
});

test('same-owner import merges rather than replaces newer local drafts and saves an account-scoped rollback', t => {
  for (const user of ['kyle', 'yeelam']) {
    const local = backup({ userId: user, sessions: [record(CYCLE + 100)], drafts: { [DKEY]: {
      text: { [ID]: 'newer local answer' }, steps: { [ID]: { mode: 'text', rows: [{ text: 'local working' }] } },
      changedAt: { ['text:' + ID]: CYCLE + 900, ['steps:' + ID]: CYCLE + 901 }, deletedAt: CYCLE + 400,
    } }, reviewPlan: { [ID]: plan(CYCLE + 800) } });
    const other = user === 'kyle' ? 'yeelam' : 'kyle';
    const sentinelKey = keyFor('dse_quiz_sessions_v2', other);
    const app = boot(t, { user, hash: '#/records', initial: { ...stored(local, user), [sentinelKey]: '["synthetic-other-account"]' } });
    const before = app.snapshot();
    const incoming = backup({ userId: user, sessions: [plain(local.sessions[0]), record(CYCLE + 200, 'synthetic-second-ID')],
      drafts: { [DKEY]: { text: { [ID]: 'old imported answer', removed: 'do not resurrect', imported: 'independent imported note' },
        paper: { imported: true }, changedAt: { ['text:' + ID]: CYCLE + 100, 'text:removed': CYCLE + 200,
          'text:imported': CYCLE + 950, 'paper:imported': CYCLE + 951 } } }, reviewPlan: { [ID]: plan(CYCLE + 100) },
    });
    const target = app.import(incoming);
    const merged = app.snapshot();
    assert.equal(merged.userId, user); assert.equal(merged.version, 2);
    assert.equal(app.api.validBackup(app.api.backupData()), true);
    assert.equal(merged.sessions.length, 2, 'same identity is not imported twice');
    assert.equal(merged.drafts[DKEY].text[ID], 'newer local answer');
    assert.equal(merged.drafts[DKEY].text.removed, undefined);
    assert.equal(merged.drafts[DKEY].text.imported, 'independent imported note');
    assert.deepEqual(merged.drafts[DKEY].steps[ID], local.drafts[DKEY].steps[ID]);
    assert.equal(merged.drafts[DKEY].deletedAt, CYCLE + 400);
    assert.deepEqual(merged.reviewPlan[ID], local.reviewPlan[ID]);
    const rollback = JSON.parse(app.saved.get(keyFor('dse_quiz_import_rollback_v1', user)));
    assert.deepEqual(state(rollback), before);
    assert.equal(rollback.userId, user);
    assert.equal(app.saved.get(sentinelKey), '["synthetic-other-account"]');
    assert.equal(target.value, '');
    assert.equal(app.confirmations.length, 1);
    assert.deepEqual(app.prompts, []);
  }
});

test('legacy unowned imports require explicit matching owner and final confirmation', t => {
  for (const user of ['kyle', 'yeelam']) {
    const legacy = backup({ version: 1, sessions: [record(CYCLE + 500)] }); delete legacy.userId;
    const other = user === 'kyle' ? 'Yeelam' : 'Kyle';
    for (const response of [null, '', other]) {
      const app = boot(t, { user, hash: '#/records', prompt: response });
      const before = [...app.saved]; app.import(legacy);
      assert.equal(app.prompts.length, 1);
      assert.deepEqual(app.confirmations, []);
      assert.deepEqual([...app.saved], before, 'cancelled or wrong-owner legacy files make no storage changes');
    }
    const declined = boot(t, { user, hash: '#/records', prompt: user, confirm: false });
    const beforeDeclined = [...declined.saved]; declined.import(legacy);
    assert.equal(declined.confirmations.length, 1);
    assert.deepEqual([...declined.saved], beforeDeclined);
    const accepted = boot(t, { user, hash: '#/records', prompt: '  ' + (user === 'kyle' ? 'Kyle' : 'Yeelam') + '  ' });
    accepted.import(legacy);
    assert.deepEqual(accepted.snapshot().sessions, legacy.sessions);
    assert.equal(accepted.snapshot().userId, user);
    assert.equal(accepted.prompts.length, 1); assert.equal(accepted.confirmations.length, 1);
    assert.ok(accepted.saved.has(keyFor('dse_quiz_import_rollback_v1', user)));
  }
});

test('invalid JSON, malformed backups, read failures and rollback-storage failures fail closed', t => {
  for (const value of ['{not-json', backup({ drafts: [] })]) {
    const app = boot(t, { hash: '#/records' });
    const before = [...app.saved]; app.import(value);
    assert.deepEqual([...app.saved], before);
    assert.deepEqual(app.confirmations, []);
    assert.match(app.node('#toast').innerHTML, /不是有效 JSON|備份格式不符/);
  }
  const unreadable = boot(t, { hash: '#/records' });
  const beforeRead = [...unreadable.saved]; unreadable.import(backup(), { error: true });
  assert.deepEqual([...unreadable.saved], beforeRead);
  assert.match(unreadable.node('#toast').innerHTML, /讀取備份失敗/);
  const app = boot(t, { hash: '#/records' });
  const before = [...app.saved], beforeState = app.snapshot();
  const write = app.context.localStorage.setItem;
  app.context.localStorage.setItem = (key, value) => {
    if (key === 'dse_quiz_import_rollback_v1') throw new Error('synthetic storage quota exceeded');
    return write(key, value);
  };
  app.import(backup({ sessions: [record(CYCLE + 200)] }));
  assert.deepEqual([...app.saved], before);
  assert.deepEqual(app.snapshot(), beforeState);
  assert.match(app.node('#toast').innerHTML, /無法保存匯入前備份/);
});
