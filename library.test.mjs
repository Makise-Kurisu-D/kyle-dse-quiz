import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const context = { Date, window: {} };
vm.createContext(context);
vm.runInContext(readFileSync(new URL('./subject-config.js', import.meta.url), 'utf8'), context);
vm.runInContext(readFileSync(new URL('./library.js', import.meta.url), 'utf8'), context);
const library = context.window.DSELibrary;
const right = { ok: true, marks: 3, tot: 3 };
const wrong = { ok: false, marks: 2, tot: 3 };
const exercise = (t, results) => ({ t, subj: 'chem', topic: 'T1', results });
const verifiedExercise = (t, results, options = {}) => exercise(t, Object.fromEntries(Object.entries(results).map(([id, result]) => {
  const copy = { ...result }, item = { id, kind:'sub', marks:result.tot, stem:'合成題', checks:['合成核對點'] };
  copy.attempt = library.attemptSnapshot(item, '學生原答', [0], copy, t, options);
  return [id, copy];
})));

test('daily review orders due, regression and repeated errors without counting replayed submissions', () => {
  const now = Date.now(), days = 864e5;
  const data = { subjects: { chem: { items: [
    { id: 'due', lost: 1 }, { id: 'repeat', lost: 2 }, { id: 'new', lost: 9 }
  ] }, bio: { items: [{ id: 'back', lost: 1 }, { id: 'due', lost: 99 }] } } };
  const history = [exercise(now-days*3, { back:right, repeat:wrong }),
    exercise(now-days*2, { back:right, repeat:wrong }), exercise(now-days, { back:wrong })];
  history.push(history[1]);
  const rows = library.dailyCandidates(data, history, { due:{dueAt:now-1} }, 'all', now);
  assert.deepEqual(Array.from(rows, r=>r.item.id), ['due','back','repeat','new']);
  assert.equal(rows[2].failures, 2);
  assert.equal(new Set(rows.map(r=>r.item.id)).size, rows.length);
  assert.deepEqual(Array.from(library.dailyCandidates(data, history, {}, 'bio', now),r=>r.item.id), ['back','due']);
});

test('daily due dates follow the Beijing calendar, including the rest of today', () => {
  const now=Date.UTC(2026,9,19,15,30), data={subjects:{chem:{items:[{id:'today'},{id:'tomorrow'}]}}};
  const rows=library.dailyCandidates(data,[],{today:{dueAt:Date.UTC(2026,9,19,15,59)},tomorrow:{dueAt:Date.UTC(2026,9,19,16)}},'all',now);
  assert.equal(rows.find(r=>r.item.id==='today').due,true);
  assert.equal(rows.find(r=>r.item.id==='tomorrow').due,false);
});

test('global search covers subjects, topics, original answers, deductions and marking checks with filters',()=>{
  const item={id:'sample-1',qref:'Q7(b)',topic:'T1',year:'2022',kind:'sub',stem:'合成題',my:[['原答案的獨有詞',true]],deduct:'漏掉必要條件',checks:['向低濃度移動'],correct:'參考解析'};
  const data={subjects:{chem:{topics:[{code:'T1',name:'運輸課題'}],items:[item]},bio:{topics:[{code:'I',name:'另一課題'}],items:[{...item,id:'sample-2',topic:'I'}]}}};
  const normalize=s=>String(s).replaceAll('输','輸').replaceAll('浓','濃').replaceAll('条','條').replaceAll('参','參');
  const f={query:'',subject:'',year:'',kind:'',status:'',tag:''},search=patch=>library.searchRows(data,{'sample-2':{state:'regressed'}},{...f,...patch},normalize,id=>id==='sample-2'?['概念混淆']:[]);
  assert.equal(search({query:'低浓度'}).length,2);assert.equal(search({query:'原答案的獨有詞'}).length,2);assert.equal(search({query:'必要条件'}).length,2);
  assert.equal(search({query:'運输課題'}).length,1);assert.equal(search({query:'Q7(b) 參考'}).length,2);
  assert.equal(search({subject:'bio',year:'2022',kind:'sub',status:'regressed',tag:'概念混淆'}).length,1);
  assert.equal(search({query:'不存在詞'}).length,0);assert.equal(search({kind:'mc'}).length,0);
});

test('global search distinguishes an unloaded private bank from zero matches',()=>{
  const root={innerHTML:''};library.reset();library.render(['search'],{root,history:[],loaded:false,data:{subjects:{}}});
  assert.match(root.innerHTML,/題庫尚未載入/);assert.doesNotMatch(root.innerHTML,/沒有匹配結果/);
});

test('reading position belongs to the content pane, not the fixed document', () => {
  library.reset();
  const pane = { scrollTop: 0 }, root = { innerHTML: '' }, frames = [];
  const api = { root, scrollRoot: pane, history: [], data: { subjects: {
    bio: { items: [], topics: [] }, chem: { items: [], topics: [] }
  } } };
  context.window.scrollY = 999;
  context.window.requestAnimationFrame = fn => frames.push(fn);
  library.render([], api);
  pane.scrollTop = 340;
  library.remember();
  pane.scrollTop = 0;
  library.render([], api);
  frames.shift()();
  assert.equal(pane.scrollTop, 340);
  assert.equal(context.window.scrollY, 999);
  library.remember();
  pane.scrollTop = 0;
  library.render([], api);
  library.reset();
  frames.shift()();
  assert.equal(pane.scrollTop, 0, 'a stale restoration cannot scroll a different route');
});

test('mastery requires saved independent evidence and a due spaced review, then regresses after a non-full answer', () => {
  const day = 864e5;
  const first = verifiedExercise(1, { q: right }, {nextReviewAt:15*day+1});
  assert.equal(library.indexHistory([first]).q.state, 'learning');
  assert.equal(library.indexHistory([first, verifiedExercise(2, {q:right})]).q.state, 'learning', 'an immediate repeat is not consolidation');
  assert.equal(library.indexHistory([first, verifiedExercise(day+1, {q:right})]).q.state, 'learning', 'the review must also be due');
  const second = verifiedExercise(15*day+1, { q: right });
  assert.equal(library.indexHistory([second, first]).q.state, 'mastered');
  assert.equal(library.indexHistory([first, second, exercise(16*day, { q: wrong })]).q.state, 'regressed');
  assert.equal(library.indexHistory([first, second, exercise(16*day, { q: wrong }), verifiedExercise(17*day, { q: right })]).q.state, 'learning');
  assert.equal(library.indexHistory([exercise(1, { q: wrong })]).q.state, 'wrong');
  assert.equal(library.full({ ok: true, marks: 299, tot: 300 }), false, 'almost-full marks are not full marks');
  assert.equal(library.indexHistory([exercise(1,{q:right}),exercise(20*day,{q:right})]).q.state,'learning','legacy scores do not invent original-answer evidence');
  assert.equal(library.indexHistory([first,verifiedExercise(20*day,{q:right},{assisted:true})]).q.state,'learning');
  assert.equal(library.indexHistory([first,verifiedExercise(20*day,{q:right},{onPaper:true})]).q.state,'learning');
  const changed=verifiedExercise(20*day,{q:right});changed.results.q.attempt.questionVersion='changed';
  assert.equal(library.indexHistory([first,changed]).q.state,'learning','different question versions require new evidence');
});

test('duplicate sync and archive copies never manufacture mastery, and conflicting copies fail conservatively', () => {
  const one = exercise(1, { q: right });
  const duplicate = JSON.parse(JSON.stringify(one));
  const combined = library.indexHistory([one, duplicate]);
  assert.equal(combined.q.attempts, 1);
  assert.equal(combined.q.state, 'learning');
  assert.equal(library.indexHistory([one, exercise(1, { q: wrong })]).q.state, 'wrong');
  assert.equal(library.indexHistory([exercise(1, { q: wrong }), one]).q.state, 'wrong');
  assert.equal(library.indexHistory([null, {}, exercise(Date.now() + 100000, { q: right })]).q, undefined);
});

test('summary counts cards once and never substitutes question maximum for original lost marks', () => {
  const stats = library.summarize([{ id: 'a', lost: 1 }, { id: 'b', tot: 12 }, { id: 'c', lost: 2 }],
    library.indexHistory([verifiedExercise(1, { a: right }), verifiedExercise(864e5+1, { a: right, b: wrong })]));
  assert.equal(stats.total, 3);
  assert.equal(stats.mastered, 1);
  assert.equal(stats.wrong, 1);
  assert.equal(stats.unseen, 1);
  assert.equal(stats.lost, 3);
  assert.equal(stats.lostKnown, 2);
});

test('a one-mark checklist cannot produce a full score by rounding half its descriptions',()=>{
  const item={id:'one-mark',kind:'sub',marks:1,checks:['比較單位成本','選擇正確方法']};
  assert.equal(library.practiceScore(item,[0],null),null);
  assert.equal(library.practiceScore(item,[0],0),0);
  assert.equal(library.practiceScore(item,[0],1),1,'a score without reviewed groups is an explicit human assessment');
  assert.equal(library.practiceScore(item,[0],1.1),null);
  item.practiceRubric={version:1,groups:[{id:'correct-selection',marks:1,all:[1]}]};
  assert.equal(library.practiceScore(item,[0],null),0);
  assert.equal(library.practiceScore(item,[1],null),1);
});

test('reviewed scoring groups preserve independent marks, required conditions and alternative answers',()=>{
  const item={marks:3,checks:['方法','條件','替代甲','替代乙','✗提醒'],practiceRubric:{version:1,groups:[
    {id:'method',marks:1,condition:{all:[0,1]}},
    {id:'answer',marks:2,condition:{any:[2,3]}}
  ]}};
  assert.equal(library.practiceScore(item,[0,2],null),2);
  assert.equal(library.practiceScore(item,[0,1,3,4],null),3);
  assert.equal(library.practiceScore(item,[2,3],null),2,'alternatives never count twice');
  item.practiceRubric.groups[0].condition={all:[4]};
  assert.equal(library.practiceRubric(item),null,'a warning cannot become a scoring condition');
  item.practiceRubric.groups[0].condition={all:[0,1]};item.practiceRubric.groups[1].marks=1;
  assert.equal(library.practiceRubric(item),null,'group maxima must match the actual maximum');
});

test('attempt snapshots preserve submitted text, selections and source versions without retaining a mutable draft or bank',()=>{
  const item={id:'snapshot',kind:'sub',marks:1,stem:'PRIVATE_QUESTION',correct:'PRIVATE_REFERENCE',checks:['point'],source_sha256:'a'.repeat(64)};
  const checked=[0],score={marks:1,tot:1,ok:true};
  const snapshot=library.attemptSnapshot(item,'原答 <script>\n第二行',checked,score,123,{nextReviewAt:456});
  checked.length=0;item.checks[0]='changed';score.marks=0;
  assert.equal(snapshot.answer,'原答 <script>\n第二行');assert.deepEqual(Array.from(snapshot.checkedIndices),[0]);
  assert.equal(snapshot.marks,1);assert.equal(snapshot.sourceSha256,'a'.repeat(64));
  assert.equal(snapshot.nextReviewAt,456);assert.equal(snapshot.rubricVersion,'manual-v1');
  assert.doesNotMatch(JSON.stringify(snapshot),/PRIVATE_QUESTION|PRIVATE_REFERENCE/);
});

test('targeted practice keeps explicit IDs, removes duplicates and bounds a selection without broadening it',()=>{
  const back='#/library/books/chem/T1';
  const href=library.drillHref('chem',['q2','q1','q2',''],back),params=new URLSearchParams(href.split('?')[1]);
  assert.equal(href.split('?')[0],'#/drill/chem');
  assert.equal(params.get('ids'),'q2,q1');assert.equal(params.get('back'),back);
  assert.equal(library.drillHref('all',[],back),'');
  assert.equal(new URLSearchParams(library.drillHref('all',Array.from({length:120},(_,i)=>'q'+i),back).split('?')[1]).get('ids').split(',').length,100);
  assert.doesNotMatch(library.drillHref('chem',['q1'],'https://other.invalid/'),/other.invalid/);
});

test('recall cards retain verified source words, deduplicate matching sources and never invent missing concepts',()=>{
  const items=[{id:'q1',stem:'合成題一',correct:'已核實正解 <script>',points:'只有符合條件才適用。',checks:['保留這個要點','✗這是警告']},
    {id:'q2',stem:'合成題二',correct:'已核實正解 <script>',points:'只有符合條件才適用。',checks:['保留這個要點','✗這是警告']},
    {id:'missing',stem:'沒有核實答案',deduct:'不要當作正解',correctOpt:'B'}];
  const before=JSON.stringify(items),cards=library.conceptCards(items);
  assert.equal(cards.length,1);assert.deepEqual(Array.from(cards[0].sources,s=>s.id),['q1','q2']);
  assert.equal(cards[0].prompt,'合成題一');assert.equal(cards[0].excerpts[0].value,'已核實正解 <script>');
  assert.equal(cards[0].excerpts[1].value,'只有符合條件才適用。');
  assert.equal(cards[0].excerpts[2].value,'保留這個要點');assert.equal(JSON.stringify(items),before);
});

test('answer comparison uses only submitted snapshots, labels paper/legacy records and preserves text safely for rendering',()=>{
  const item={id:'compare',kind:'sub',marks:3,stem:'合成題'},first=exercise(1,{compare:{...wrong}}),second=exercise(2,{compare:{...right}});
  first.results.compare.attempt=library.attemptSnapshot(item,'第一份原答',[],first.results.compare,1);
  second.results.compare.attempt=library.attemptSnapshot(item,'<script>第二份原答\n第二行',[],second.results.compare,2);
  let rows=library.submittedAnswers(item,[first,second,second]);
  assert.equal(rows.length,2);assert.equal(rows[0].answer,'<script>第二份原答\n第二行');assert.equal(rows[1].answer,'第一份原答');
  const paper=exercise(3,{compare:{...right}});paper.results.compare.attempt=library.attemptSnapshot(item,'紙上作答',[],paper.results.compare,3,{onPaper:true});
  rows=library.submittedAnswers(item,[first,paper]);assert.equal(rows[0].onPaper,true);assert.equal(rows[0].answer,null);
  const legacy=exercise(4,{compare:{...right}});rows=library.submittedAnswers(item,[first,legacy]);assert.equal(rows[0].answer,null);
  const changed=exercise(5,{compare:{...right,attempt:{...second.results.compare.attempt,questionId:'different',submittedAt:5}}});
  assert.equal(library.submittedAnswers(item,[changed])[0].answer,null,'a mismatched snapshot is not an answer for this question');
});

function reviewFixture(sharedStorage=new Map()) {
  const frames=[],nodes=new Map(),reading=[],timers=[];
  const later=fn=>{timers.push(fn);return fn;},cancel=fn=>{const index=timers.indexOf(fn);if(index>=0)timers.splice(index,1);};
  const pane={scrollTop:0,getBoundingClientRect:()=>({top:80})};
  const makeNode=id=>({id,innerHTML:'',textContent:'',value:'',hidden:false,href:'',events:{},
    addEventListener(name,fn){this.events[name]=fn;},removeEventListener(){},
    querySelectorAll(){return [];},getAttribute(name){return name==='data-reading-id'?id:null;},
    hasAttribute(name){return name==='data-reading-id';},getBoundingClientRect(){return {top:160-pane.scrollTop,bottom:760-pane.scrollTop,height:600};}});
  const root={innerHTML:'',events:{},querySelector(selector){
    if(selector==='.ml-question')return reading[0] || null;
    if(!nodes.has(selector))nodes.set(selector,makeNode(selector));return nodes.get(selector);
  },querySelectorAll(selector){return selector==='[data-reading-id]'?reading:[];},addEventListener(name,fn){this.events[name]=fn;},removeEventListener(name,fn){if(this.events[name]===fn)delete this.events[name];}};
  const window={requestAnimationFrame:fn=>frames.push(fn),location:{hash:'#/library/books/chem/T1'},
    localStorage:{getItem:key=>sharedStorage.get(key) || null,setItem:(key,value)=>sharedStorage.set(key,value)},
    setTimeout:later,clearTimeout:cancel};
  const sandbox={Date,window,setTimeout:later,clearTimeout:cancel};vm.createContext(sandbox);
  vm.runInContext(readFileSync(new URL('./subject-config.js',import.meta.url),'utf8'),sandbox);
  vm.runInContext(readFileSync(new URL('./library.js',import.meta.url),'utf8'),sandbox);
  const items=[{id:'q-wrong',kind:'mc',year:'2022',topic:'T1',stem:'合成題',correct:'正解原文',options:['甲','乙'],correctOpt:'A',qref:'Q1',paper:'卷一'},
    {id:'q-right',kind:'sub',year:'2022',topic:'T1',stem:'第二題',correct:'另一正解',qref:'Q2',paper:'卷一'}];
  const history=[exercise(1,{'q-wrong':{...wrong},'q-right':{...right}})];
  const api={root,scrollRoot:pane,userId:'kyle',history,data:{subjects:{chem:{topics:[{code:'T1',name:'合成課題'}],items}}},cycleStart:0,normalize:String,formatDate:String,hydrate(){}};
  return {library:window.DSELibrary,api,root,nodes,reading,pane,frames,timers,makeNode,storage:sharedStorage,window};
}

test('topic filters and cross-subject search build a practice link for exactly the matching questions',()=>{
  const f=reviewFixture(),before=JSON.stringify(f.api.history);
  f.library.render(['chem','T1'],f.api);
  const status=f.root.querySelector('#mlStatus');status.value='wrong';status.events.change();
  const selected=new URLSearchParams(f.root.querySelector('#mlFilteredPractice').href.split('?')[1]);
  assert.equal(selected.get('ids'),'q-wrong');assert.equal(selected.get('back'),'#/library/books/chem/T1');
  assert.equal(f.root.querySelector('#mlFilteredPractice').textContent,'練習篩出的 1 題');
  assert.match(f.root.querySelector('#mlQuestions').innerHTML,/data-reading-id="answer-q-wrong"><summary>先回憶/);
  assert.doesNotMatch(f.root.querySelector('#mlQuestions').innerHTML,/<details class="ml-reveal"[^>]*\bopen\b/);
  assert.match(f.root.querySelector('#mlQuestions').innerHTML,/#\/drill\/chem\?ids=q-wrong&amp;back=/);
  f.library.remember();f.library.render(['search'],f.api);
  const kind=f.root.querySelector('#globalKind');kind.value='mc';kind.events.change();
  const globalLink=f.root.querySelector('#globalPractice').href;
  assert.match(globalLink,/#\/drill\/all\?/);assert.equal(new URLSearchParams(globalLink.split('?')[1]).get('ids'),'q-wrong');
  assert.equal(JSON.stringify(f.api.history),before,'reading and filtering do not write attempt evidence');
});

test('account reading state survives a reload with filters, expanded answer cards and an anchor while another account starts clean',()=>{
  const store=new Map(),one=reviewFixture(store);
  one.library.render(['chem','T1'],one.api);
  const status=one.root.querySelector('#mlStatus');status.value='wrong';status.events.change();
  const question=one.makeNode('question-q-wrong'),answer=one.makeNode('answer-q-wrong');question.open=true;answer.open=true;
  one.reading.push(question,answer);one.pane.scrollTop=240;one.library.remember();
  const snapshot=JSON.parse(store.get('dse_library_view_v1:kyle'));
  assert.equal(snapshot.filters['chem/T1'].status,'wrong');assert.equal(snapshot.positions['chem/T1'].open['answer-q-wrong'],true);
  assert.equal(snapshot.positions['chem/T1'].anchor.id,'answer-q-wrong');
  assert.doesNotMatch(store.get('dse_library_view_v1:kyle'),/正解原文|另一正解|學生原答/,'view storage contains IDs and positions, not copied private answers');
  const reload=reviewFixture(store),restoredQuestion=reload.makeNode('question-q-wrong'),restoredAnswer=reload.makeNode('answer-q-wrong');
  reload.reading.push(restoredQuestion,restoredAnswer);reload.library.render(['chem','T1'],reload.api);reload.frames.forEach(fn=>fn());
  assert.equal(reload.root.querySelector('#mlStatus').value,'wrong');assert.equal(restoredAnswer.open,true);assert.equal(reload.pane.scrollTop,240);
  reload.library.reset();reload.reading.length=0;reload.pane.scrollTop=0;reload.library.render(['chem','T1'],{...reload.api,userId:'yeelam'});
  assert.equal(reload.root.querySelector('#mlStatus').value,'');assert.equal(reload.pane.scrollTop,0);
  const other=JSON.parse(store.get('dse_library_view_v1:yeelam') || 'null');
  assert.equal(other && other.filters['chem/T1'] ? other.filters['chem/T1'].status : '', '');
  assert.equal(other && other.positions['chem/T1'] ? Object.keys(other.positions['chem/T1'].open).length : 0,0);
});

test('reading remains usable when local storage is blocked or malformed and concept reveal stays closed',()=>{
  const f=reviewFixture();f.window.localStorage={getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');}};
  assert.doesNotThrow(()=>f.library.render(['concepts','chem','T1'],f.api));
  assert.match(f.root.innerHTML,/先看題目，用自己的話回憶/);assert.match(f.root.innerHTML,/正解原文/);
  assert.doesNotMatch(f.root.innerHTML,/<details class="ml-recall"[^>]*\bopen\b/);
  assert.doesNotThrow(()=>f.library.remember());
  f.library.reset();f.window.localStorage={getItem:()=>'{broken',setItem(){}};
  assert.doesNotThrow(()=>f.library.render(['concepts'],f.api));assert.match(f.root.innerHTML,/概念回顧/);
});

test('a delayed search from the previous account cannot repaint the next account on the same topic route',()=>{
  const f=reviewFixture();f.library.render(['chem','T1'],f.api);
  const search=f.root.querySelector('#mlSearch');search.value='old account query';search.events.input();
  const pending=f.timers.slice();f.library.reset();
  const item={...f.api.data.subjects.chem.items[0],id:'new-account-only',stem:'新帳號題目'};
  f.library.render(['chem','T1'],{...f.api,userId:'yeelam',history:[],data:{subjects:{chem:{topics:[{code:'T1',name:'合成課題'}],items:[item]}}}});
  const before=f.root.querySelector('#mlQuestions').innerHTML;pending.forEach(fn=>fn());
  assert.equal(f.root.querySelector('#mlQuestions').innerHTML,before);assert.match(before,/new-account-only/);
});

test('a paper-linked question and its single-question practice both return to the validated paper location',()=>{
  const f=reviewFixture(),back='#/library/papers/chem/2022';
  f.window.location.hash='#/library/books/question/chem/q-wrong?back='+encodeURIComponent(back);
  f.library.render(['question','chem','q-wrong'],f.api);
  assert.match(f.root.innerHTML,/href="#\/library\/papers\/chem\/2022">← 原來的複習位置/);
  const drill=f.root.innerHTML.match(/class="btn btn-primary ml-redo-one" href="([^"]+)"/)[1].replaceAll('&amp;','&');
  assert.equal(new URLSearchParams(drill.split('?')[1]).get('back'),back);
  assert.equal(new URLSearchParams(drill.split('?')[1]).get('ids'),'q-wrong');
  for(const unsafe of ['https://other.invalid/','javascript:alert(1)','#//other.invalid/','#/library/books?sync=private','#/library/papers/chem/2022\n']) {
    f.window.location.hash='#/library/books/question/chem/q-wrong?back='+encodeURIComponent(unsafe);
    f.library.render(['question','chem','q-wrong'],f.api);
    assert.match(f.root.innerHTML,/href="#\/library\/books\/search">← 搜尋結果/);
    assert.doesNotMatch(f.root.innerHTML,/原來的複習位置/);
  }
});

test('personal reminders remain local, escaped and account-specific without changing submitted answer evidence',()=>{
  const f=reviewFixture(),before=JSON.stringify(f.api.history),note='先檢查單位 <script>\n再核對對象';
  f.library.render(['question','chem','q-wrong'],f.api);
  const status={textContent:''},target={value:note,getAttribute:name=>name==='data-note-id'?'q-wrong':null,closest:()=>({querySelector:()=>status})};
  f.root.events.input({target});
  assert.equal(f.storage.get('dse_library_note_v1:kyle:q-wrong'),note);assert.equal(status.textContent,'已保存在此裝置。');
  f.library.remember();f.library.render(['question','chem','q-wrong'],f.api);
  assert.match(f.root.innerHTML,/先檢查單位 &lt;script&gt;\n再核對對象/);assert.match(f.root.innerHTML,/僅本機保存/);
  assert.equal(JSON.stringify(f.api.history),before);
  f.library.reset();f.library.render(['question','chem','q-wrong'],{...f.api,userId:'yeelam'});
  assert.doesNotMatch(f.root.innerHTML,/先檢查單位/);
  f.root.events.input({target:{...target,value:'另一個帳號的提醒'}});
  assert.equal(f.storage.get('dse_library_note_v1:yeelam:q-wrong'),'另一個帳號的提醒');assert.equal(f.storage.get('dse_library_note_v1:kyle:q-wrong'),note);
  f.window.localStorage={getItem:()=>'',setItem(){throw new Error('full');}};
  f.root.events.input({target});assert.match(status.textContent,/未能保存/);
});
