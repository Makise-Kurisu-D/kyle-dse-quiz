import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('./ios-widget.js',import.meta.url),'utf8');
const sandbox={ Date, config:{runsInApp:false,runsInWidget:false}, Script:{complete(){}}, Keychain:{get(){throw Error('empty')}}, console };
vm.createContext(sandbox);
await vm.runInContext(`(async()=>{${source.replace('await run()','')}; globalThis.api={grade,summarize,nextCycle,beijingDate};})()`,sandbox);
const {grade,summarize,nextCycle,beijingDate}=sandbox.api;
test('each paper uses its own boundaries and missing grades remain unknown',()=>{
 assert.equal(grade({earned:80,total:100,boundaries:[{level:'4',minimumPercent:70},{level:'5',minimumPercent:80}]}).level,'5');
 assert.equal(grade({earned:4,total:10,boundaries:[]}).level,null);
 assert.equal(grade({earned:11,total:10}),null);
});
test('average weights papers equally, keeps same-year papers separate and respects account subjects',()=>{
 const bank={subjects:{math:{items:[{},{}]},m2:{items:[]},physics:{items:[{}]},chem:{items:[{}, {}, {}]}}};
 const catalog={subjects:{},papers:{math:{2025:{assessment:{earned:1,total:1}}}},entries:[
  {subject:'math',year:'2025',paper_id:'one',assessment:{earned:8,total:10,boundaries:[{level:'5',minimumPercent:80}]}},
  {subject:'math',year:'2025',paper_id:'two',assessment:{earned:30,total:100,boundaries:[{level:'2',minimumPercent:30}]}},
  {subject:'math',year:'2022',assessment:{earned:0,total:0}}]};
 const rows=summarize('yeelam',bank,catalog);
 assert.deepEqual(Array.from(rows,r=>r.code),['math','m2','physics']);
 assert.equal(rows[0].average,55); assert.equal(rows[0].count,2); assert.equal(rows[0].papers,2);
 assert.deepEqual(Array.from(rows[0].levels),['25·one:5','25·two:2']);
 assert.equal(rows[1].average,null); assert.equal(rows[2].count,1);
});
test('cycle rolls over at midnight Beijing time without clearing anything',()=>{
 assert.equal(nextCycle(new Date('2026-10-18T15:59:59Z')).toISOString(),'2026-10-18T16:00:00.000Z');
 assert.equal(nextCycle(new Date('2026-10-18T16:00:00Z')).toISOString(),'2026-11-01T16:00:00.000Z');
 assert.equal(beijingDate(new Date('2026-10-18T16:00:00Z')),'10/19 00:00');
});

test('login stores only the authenticated account and session, preserving the old account on failure',async()=>{
 const store=new Map(), requests=[]; let status=200;
 class Alert { addTextField(){} addSecureTextField(){} addAction(){} addCancelAction(){} async presentAlert(){return 0} textFieldValue(i){return i ? 'synthetic-password' : 'Yeelam'} }
 class Request { constructor(url){this.url=url} async loadJSON(){requests.push({url:this.url,headers:this.headers,body:this.body});this.response={statusCode:status};return status===200?{userId:'yeelam',sessionId:'y'.repeat(43)}:{error:'invalid_password'}} }
 const c={Date,config:{runsInApp:false,runsInWidget:false},Script:{complete(){}},Alert,Request,Keychain:{get:k=>store.get(k),set:(k,v)=>store.set(k,v)}};
 vm.createContext(c);await vm.runInContext(`(async()=>{${source.replace('await run()','')};globalThis.api={signIn,savedSession}})()`,c);
 await c.api.signIn(); const value=c.api.savedSession();
 assert.equal(value.user,'yeelam');assert.equal(value.session,'y'.repeat(43));
 assert.equal(requests[0].headers.Origin,'https://makise-kurisu-d.github.io');
 assert.ok(!JSON.stringify([...store]).includes('synthetic-password'));
 status=401;await assert.rejects(c.api.signIn());assert.equal(c.api.savedSession().session,'y'.repeat(43));
});
