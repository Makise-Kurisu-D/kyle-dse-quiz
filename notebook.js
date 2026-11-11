/* A single, content-first notebook shell. No theme/appearance state or learner data migration. */
(function () {
  'use strict';
  var storage = window.QUIZ_STORAGE || window.localStorage;
  var icons = {
    chem:'<path d="M9 3h6m-5 0v7L4 19c-.6 1 .2 2 1.3 2h13.4c1.1 0 1.9-1 1.3-2l-6-9V3M7 15h10"/>',
    bio:'<path d="M20 4C8 2 2 10 6 17s14 1 14-13ZM5 21l10-11m-6 6V9m0 7h7"/>',
    math:'<path d="M4 9h4l3 11 5-17h5M16 13h5m-5 5h5"/>',
    m2:'<path d="M15 3c-6-2-4 20-10 18m3-9h11m-4-4 4 4-4 4"/>',
    physics:'<path d="m13 2-9 12h7l-1 8 10-12h-7l1-8Z"/>'
  };
  if (window.DSESubjects) window.DSESubjects = Object.assign({}, window.DSESubjects, {icon:function (code) {
    return '<svg class="subject-icon" viewBox="0 0 24 24" aria-hidden="true">' + (icons[code] || icons.math) + '</svg>';
  }});
  var user = storage.getItem('dse_quiz_user_v1') === 'yeelam' ? 'yeelam' : 'kyle';
  document.getElementById('accountName').textContent = user === 'yeelam' ? 'Yeelam' : 'Kyle';
  document.getElementById('accountInitial').textContent = user === 'yeelam' ? 'Y' : 'K';
  function navigation() {
    var parts = (location.hash.split('?')[0] || '#/').split('/'), view = parts[1] || 'home';
    if (view === 'library' && parts[2] === 'papers') view = 'papers';
    if (['today','drill','session','random'].indexOf(view) >= 0) view = 'practice';
    document.querySelectorAll('[data-route]').forEach(function (link) {
      var active = link.dataset.route === view;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    });
    document.body.dataset.view = view;
    var title = {home:'今日學習',practice:'練習',library:'錯題本',papers:'批改卷',records:'學習記錄'}[view] || '學習手冊';
    document.title = title + ' · 拾題 DSE' + (window.QUIZ_DEMO ? ' · 模擬演示' : '');
  }
  window.addEventListener('hashchange', navigation);
  document.getElementById('skipLink').addEventListener('click', function (event) { event.preventDefault(); document.getElementById('app').focus(); });
  // Keep the shell informative even on routes without a per-page sync status.
  window.addEventListener('offline', function () { document.body.classList.add('is-offline'); });
  window.addEventListener('online', function () { document.body.classList.remove('is-offline'); });
  if (window.QUIZ_DEMO) {
    var demo = document.createElement('div'); demo.className = 'demo-banner';
    demo.innerHTML = '<span><b>模擬演示</b> · 題目、原卷與記錄均為合成資料，不會連接私人資料。</span><label>切換體驗帳戶 <select id="demoAccount"><option value="kyle">Kyle</option><option value="yeelam">Yeelam</option></select></label><a href="../">正式網站 ↗</a>';
    document.querySelector('.site-header').after(demo);
    document.getElementById('demoAccount').value = user;
    document.getElementById('demoAccount').addEventListener('change', function (event) {
      storage.setItem('dse_quiz_user_v1', event.target.value); location.href = location.pathname + '#/'; location.reload();
    });
  }
  navigation();
})();
