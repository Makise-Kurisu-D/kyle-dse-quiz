/* A fully local fake transport. The demo cannot reach the private Worker. */
(function () {
  'use strict';
  var storage = window.QUIZ_STORAGE = {
    getItem:function (key) {return window.localStorage.getItem('dse_demo_' + key);},
    setItem:function (key,value) {window.localStorage.setItem('dse_demo_' + key,String(value));},
    removeItem:function (key) {window.localStorage.removeItem('dse_demo_' + key);}
  };
  var user = storage.getItem('dse_quiz_user_v1') === 'yeelam' ? 'yeelam' : 'kyle';
  var api = new URL('./__demo_api', location.href).href.replace(/\/$/,'');
  window.QUIZ_DEMO = true;
  window.QUIZ_SYNC_API = api;
  window.QUIZ_PRIVATE_BANK = true;
  window.QUIZ_PASSWORD_AUTH = true;
  storage.setItem('dse_quiz_sync_session_v1','synthetic_demo_' + user + '_0123456789abcdef0123456789abcdef');
  storage.setItem('dse_quiz_auth_mode_v1','password');
  var nativeFetch = window.fetch.bind(window);
  function json(data, status) {return new Response(JSON.stringify(data),{status:status || 200,headers:{'Content-Type':'application/json'}});}
  function page(number) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1260" viewBox="0 0 900 1260">' +
      '<rect width="900" height="1260" fill="#fffefa"/><g fill="#263d36" font-family="sans-serif">' +
      '<text x="70" y="85" font-size="30">拾題 · 原創模擬卷 / ' + number + '</text>' +
      '<text x="70" y="130" font-size="19">SYNTHETIC EXAMPLE — NOT AN EXAMINATION OR STUDENT RECORD</text>' +
      '<path d="M70 160h760" stroke="#d9ded2"/>' +
      (number === 1 ? '<text x="70" y="230" font-size="26">MC1　' + window.QUIZ_DEMO_BANK.subjects.math.items[0].stemFull.split('\n')[1] + '</text>' +
        '<text x="100" y="310" font-size="24">A. 5　　B. 3　　C. 15　　D. 25</text><text x="70" y="430" font-size="26">Q1(a)　列明解方程的步驟。</text>' :
        '<text x="70" y="230" font-size="26">Q1(a)　完整推理與參考</text><text x="70" y="310" font-size="24">3x + 5 = 20</text><text x="70" y="370" font-size="24">3x = 15</text><text x="70" y="430" font-size="24">x = 5</text>') +
      '<path d="M70 550h760m-760 85h760m-760 85h760m-760 85h760" stroke="#d9ded2"/>' +
      '<text x="70" y="970" font-size="20" fill="#a8492c">模擬批注：先核對條件，再列出步驟；本頁沒有真實學生成績。</text>' +
      '<text transform="translate(170 850) rotate(-30)" font-size="90" fill="#244b4312">模 擬 資 料</text>' +
      '<text x="70" y="1190" font-size="18">Demo / 本頁僅示範閱讀、批注定位與重做流程。</text></g></svg>';
    return new Response(svg,{headers:{'Content-Type':'image/svg+xml'}});
  }
  window.fetch = function (input, options) {
    options = options || {};
    var url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.href.indexOf(api + '/') !== 0) {
      // Fail closed rather than accidentally sending demo credentials to production.
      if (url.origin !== location.origin) return Promise.reject(new TypeError('演示版不連接外部資料服務'));
      return nativeFetch(input,options);
    }
    var path = url.pathname.slice(new URL(api).pathname.length), method = options.method || 'GET';
    var account = storage.getItem('dse_quiz_user_v1') === 'yeelam' ? 'yeelam' : 'kyle';
    var codes = window.DSESubjects ? window.DSESubjects.codes(account) : (account === 'yeelam' ? ['math','m2','physics'] : ['chem','bio','math']);
    var cloudKey = 'dse_demo_cloud_' + account;
    try {
      if (path === '/auth/password') {
        var login = JSON.parse(options.body || '{}'), nextUser = String(login.username || '').toLowerCase();
        if (['kyle','yeelam'].indexOf(nextUser) < 0) return Promise.resolve(json({error:'invalid_user'},401));
        return Promise.resolve(json({userId:nextUser,sessionId:'synthetic_demo_' + nextUser + '_0123456789abcdef0123456789abcdef'}));
      }
      if (path === '/auth/logout') return Promise.resolve(json({ok:true}));
      if (path === '/bank') return Promise.resolve(json(window.DSESubjects.bankFor(account,window.QUIZ_DEMO_BANK)));
      if (path === '/sync') {
        if (method === 'PUT') {
          var payload = JSON.parse(options.body || '{}');
          window.localStorage.setItem(cloudKey,JSON.stringify(payload.data));
          return Promise.resolve(json({sha:'local-demo-copy',savedAt:new Date().toISOString()}));
        }
        if (method === 'DELETE') {window.localStorage.removeItem(cloudKey);return Promise.resolve(json({ok:true}));}
        return Promise.resolve(json({data:JSON.parse(window.localStorage.getItem(cloudKey) || 'null'),sha:'local-demo-copy'}));
      }
      if (path === '/ai/status') return Promise.resolve(json({configured:false,practiceEnabled:false,modes:['review','followup']}));
      if (path === '/papers/catalog') {
        var catalog = {subjects:{},papers:{}};
        codes.forEach(function (code) {
          catalog.subjects[code] = code === 'math' ? ['2022'] : [];
          catalog.papers[code] = code === 'math' ? {'2022':{title:'原創模擬數學批改卷 · 非真實成績',pages:2}} : {};
        });
        return Promise.resolve(json(catalog));
      }
      if (path === '/papers/math/2022/manifest') return Promise.resolve(json({version:'abcdef0123456789',pages:2,page_sizes:[[900,1260],[900,1260]],
        sections:[{label:'模擬作答',page:1},{label:'模擬批注',page:2}],mistakes:[
          {label:'MC1',question_id:'demo-math-1',page:1,x:.2,y:.25},
          {label:'Q1(a)',question_id:'demo-math-5',page:2,x:.22,y:.3}]}));
      if (/^\/papers\/math\/2022\/pages\/(?:abcdef0123456789\/)?[12]$/.test(path)) return Promise.resolve(page(Number(path.slice(-1))));
      return Promise.resolve(json({error:'paper_not_accessible'},404));
    } catch (_) {return Promise.resolve(json({error:'invalid_demo_payload'},400));}
  };
})();
