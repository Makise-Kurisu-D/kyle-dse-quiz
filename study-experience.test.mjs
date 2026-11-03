import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const context = { window: {} };
vm.createContext(context);
vm.runInContext(readFileSync(new URL('./study-experience.js', import.meta.url), 'utf8'), context);
const study = context.window.DSEStudy;
const plain = value => JSON.parse(JSON.stringify(value));
const ids = rows => Array.from(rows, item => item.id);

test('return navigation accepts internal study routes and rejects external, script and callback routes', () => {
  for (const route of ['#/', '#/records', '#/practice/chem', '#/session/chem/T1',
    '#/today/all/5?kind=mc', '#/drill/chem?ids=a%2Cb&back=%23%2F',
    '#/library/books/concepts/chem/T1', '#/library/papers/math/2022/mock-set']) {
    assert.equal(study.safeRoute(route), route);
  }
  for (const route of [undefined, null, '', 'https://example.com/', '//example.com/',
    'javascript:alert(1)', 'data:text/html,test', '#//example.com/', '#/unknown',
    '#/records\n', '#/records?<script>', '#/records?handoff=private-token',
    '#/records?sync=connected', '#/records?%68andoff=private-token',
    '#/records?HANDOFF=private-token', '#/records?handoff=%E0%A4%A',
    '#/records?%68andoff=%E0%A4%A', '#/records?handoff', '#/records?' + 'x'.repeat(24000)]) {
    assert.equal(study.safeRoute(route), '#/', String(route));
    assert.equal(study.safeRoute(route, '#/library/books'), '#/library/books');
  }
});

test('query decoding tolerates malformed components and preserves literal plus and nested return routes', () => {
  assert.deepEqual(plain(study.query('#/drill/chem?ids=a%2Cb&broken=%E0%A4%A&%E0%A4%A=x&back=%23%2Flibrary%2Fbooks%3Fkind%3Dmc&text=a+b%2Bc&flag&empty=')), {
    ids: 'a,b', back: '#/library/books?kind=mc', text: 'a b+c', empty: '',
  });
  assert.deepEqual(plain(study.query('#/records')), {});
  assert.deepEqual(plain(study.query('#/records?kind=mc&kind=sub')), { kind: 'sub' });
});

test('drill links carry an exact ordered selection and a safe return destination', () => {
  const href = study.drillHref('chem', ['synthetic-mc-1', 'synthetic-q-2'], '#/library/books/chem/T1?kind=mc', 'chem:T1');
  assert.equal(href.startsWith('#/drill/chem?'), true);
  assert.deepEqual(plain(study.query(href)), {
    ids: 'synthetic-mc-1,synthetic-q-2', back: '#/library/books/chem/T1?kind=mc', draft: 'chem:T1',
  });
  assert.equal(study.query(study.drillHref('all', ['a'], 'javascript:alert(1)')).back, '#/');
});

test('question references ignore marks and preceding paper metadata while preserving subparts', () => {
  for (const [source, expected] of [
    ['Q1(a)（2分）', 'q1a'], ['Paper 2 · Q4(b) (2 marks)', 'q4b'],
    ['Q4（b）（ii）（1分）', 'q4bii'], ['第04題(b)(ii)', 'q4bii'],
    ['MC 03（1分）', 'mc3'], ['卷二 選擇題 8', 'mc8'], ['4(b)', 'q4b'],
    ['Q10(c)(i)(2)', 'q10ci2'], ['未能對應題號', ''],
  ]) assert.equal(study.reference(source), expected, source);
});

test('paper matching prefers an exact stable question id, then an exact annotated subpart', () => {
  const items = [
    { id: 'a', year: '2022', qref: 'Q1(a)（2分）' },
    { id: 'b', year: '2022', qref: 'Q1(b)（3分）' },
    { id: 'mc', year: '2022', qref: 'MC1' },
  ];
  assert.deepEqual(ids(study.paperMatches({ question_id: 'a', label: 'Q1(b)' }, items, '2022', '')), ['a']);
  assert.deepEqual(ids(study.paperMatches({ question_id: 'Q1', label: 'Q1(b)' }, items, 2022, '')), ['b']);
  assert.deepEqual(ids(study.paperMatches({ question_id: 'MC1', label: 'MC1' }, items, '2022', '')), ['mc']);
  assert.deepEqual(ids(study.paperMatches({ question_id: 'Q1', label: 'Q1(c)' }, items, '2022', '')), [],
    'a missing subpart must not select its siblings');
});

test('a shared annotation maps only its explicit subquestion range and descendants', () => {
  const items = ['a', 'b', 'bi', 'c', 'd', 'e'].map(part => ({ id: part, year: '2022', qref: part === 'bi' ? 'Q19(b)(i)' : 'Q19(' + part + ')' }));
  items.push({ id: 'other-number', year: '2022', qref: 'Q190(b)' });
  for (const label of ['Q19(b)–(d)', 'Q19（b）至（d）', 'Q19(b)-Q19(d)']) {
    assert.deepEqual(ids(study.paperMatches({ question_id: 'Q19', label }, items, '2022', '')), ['b', 'bi', 'c', 'd']);
  }
  assert.deepEqual(ids(study.paperMatches({ question_id: 'Q19', label: 'Q19(d)–(b)' }, items, '2022', '')), []);
  assert.deepEqual(ids(study.paperMatches({ question_id: 'Q19', label: 'Q19(b)-Q20(d)' }, items, '2022', '')), []);
  assert.deepEqual(ids(study.paperMatches({ question_id: 'Q19', label: 'Q19(b)(i)–(iii)' }, items, '2022', '')), []);
  assert.deepEqual(ids(study.paperMatches({ question_id: 'Q19', label: 'Q19(b)、(d)' }, items, '2022', '')), []);
  assert.deepEqual(ids(study.paperMatches({ question_id: 'Q19', label: 'Q19' }, items, '2022', '')), ['a', 'b', 'bi', 'c', 'd', 'e']);
});

test('paper matches stay inside the caller subject pool, year and exact named-paper identity', () => {
  const chem = [
    { id: 'legacy', year: '2022', qref: 'Q1(a)' },
    { id: 'other-year', year: '2021', qref: 'Q1(a)' },
    { id: 'mock-a', year: '2022', paper_id: 'mock-a', qref: 'Q1(a)' },
    { id: 'mock-b', year: '2022', paper_id: 'mock-b', qref: 'Q1(a)' },
  ];
  const bio = [{ id: 'bio-only', year: '2022', qref: 'Q1(a)' }];
  const target = { question_id: 'Q1', label: 'Q1(a)' };
  assert.deepEqual(ids(study.paperMatches(target, chem, '2022', '')), ['legacy']);
  assert.deepEqual(ids(study.paperMatches(target, chem, '2022', 'mock-a')), ['mock-a']);
  assert.deepEqual(ids(study.paperMatches(target, chem, '2021', 'mock-a')), []);
  assert.deepEqual(ids(study.paperMatches(target, chem, '2022', 'missing-set')), []);
  assert.deepEqual(ids(study.paperMatches(target, bio, '2022', '')), ['bio-only']);
  assert.deepEqual(ids(study.paperMatches({ question_id: 'other-year' }, chem, '2022', '')), []);
  assert.deepEqual(ids(study.paperMatches({ question_id: 'removed-2022-question' },
    [{ id: 'unrelated', year: '2022', qref: 'Q2022' }], '2022', '')), [],
    'digits embedded in an unavailable stable id are not an annotated question number');
  assert.deepEqual(ids(study.paperMatches(null, chem, '2022', '')), []);
});

const currentBank = { subjects: {
  chem: { items: [{ id: 'mc-a', kind: 'mc' }, { id: 'sub-a', kind: 'sub' }] },
  math: { items: [{ id: 'mc-math', kind: 'mc' }] },
} };

test('unfinished task selection excludes unavailable account subjects, removed ids and empty answers', () => {
  const drafts = {
    'bio:T1': { pick: { 'bio-private': 'A' }, changedAt: { 'pick:bio-private': 1000 } },
    'chem:empty': { pick: { 'mc-a': '' }, text: { 'sub-a': '  \n ' } },
    'chem:removed': { pick: { 'removed-id': 'B' }, changedAt: { 'pick:removed-id': 1000 } },
    'chem:invalid-choice': { pick: { 'mc-a': 'Z' }, changedAt: { 'pick:mc-a': 1000 } },
    'chem:T1': { pick: { 'mc-a': 'B' }, text: { 'sub-a': '  \n ' }, changedAt: { 'pick:mc-a': 20 } },
  };
  const task = study.draftTask(drafts, currentBank);
  assert.deepEqual(plain(task.ids), ['mc-a']);
  assert.equal(task.code, 'chem');
  assert.equal(task.draft, 'chem:T1');
  assert.equal(task.at, 20);
  assert.equal(study.query(task.href).draft, 'chem:T1');
  assert.equal(study.draftTask({ 'bio:T1': drafts['bio:T1'] }, currentBank), null);
  assert.equal(study.draftTask({}, currentBank), null);
  assert.equal(study.draftTask(drafts, null), null);
});

test('all-subject tasks include only current-account items and choose the most recent available work', () => {
  const task = study.draftTask({
    'all:__today__': { pick: { 'mc-a': 'A', 'mc-math': 'C', 'foreign-id': 'B' }, changedAt: { 'pick:mc-a': 10, 'pick:mc-math': 11, 'pick:foreign-id': 1000 } },
    'chem:T1': { text: { 'sub-a': '最近尚未提交的答案' }, changedAt: { 'text:sub-a': 20 } },
  }, currentBank);
  assert.equal(task.draft, 'chem:T1');
  assert.deepEqual(plain(task.ids), ['sub-a']);
  const all = study.draftTask({ 'all:__today__': { pick: { 'mc-a': 'A', 'mc-math': 'C', 'foreign-id': 'B' } } }, currentBank);
  assert.equal(all.code, 'all');
  assert.deepEqual(plain(all.ids), ['mc-a', 'mc-math']);
});

test('deleted task fields never resume, but later answers remain resumable across the same tombstone', () => {
  const stale = { deletedAt: 30, pick: { 'mc-a': 'A' }, text: { 'sub-a': '舊答案' }, paper: { 'sub-a': true },
    changedAt: { 'pick:mc-a': 10, 'text:sub-a': 20, 'paper:sub-a': 30 } };
  assert.equal(study.draftTask({ 'chem:T1': stale }, currentBank), null);
  const newer = { ...stale, text: { 'sub-a': '刪除後重新作答' }, changedAt: { ...stale.changedAt, 'text:sub-a': 40 } };
  const task = study.draftTask({ 'chem:T1': newer }, currentBank);
  assert.deepEqual(plain(task.ids), ['sub-a']);
  assert.equal(task.at, 40);
  const paper = study.draftTask({ 'chem:T1': { deletedAt: 30, paper: { 'sub-a': true }, changedAt: { 'paper:sub-a': 41 } } }, currentBank);
  assert.deepEqual(plain(paper.ids), ['sub-a']);
});
