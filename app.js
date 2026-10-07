/* Kyle 錯題速記 —— 遮答案閃卡邏輯（原生 JS，無依賴，可離線） */
(function () {
  'use strict';

  var LS_PROG = 'dse_quiz_progress_v1';
  var LS_PREF = 'dse_quiz_prefs_v1';

  var DATA = window.QUIZ_DATA;
  var progress = {};
  try { progress = JSON.parse(localStorage.getItem(LS_PROG)) || {}; } catch (e) {}
  var prefs = {
    subject: 'chem', topic: 'ALL', kind: 'ALL', status: 'ALL',
    shuffle: false, answerMode: 'write'
  };
  try {
    var saved = JSON.parse(localStorage.getItem(LS_PREF));
    if (saved) Object.keys(saved).forEach(function (k) { prefs[k] = saved[k]; });
  } catch (e) {}
  if (!DATA.subjects[prefs.subject]) prefs.subject = 'chem';

  var queue = [];
  var pos = 0;
  var revealed = false;
  var mcPick = null;
  var draftTimer = null;

  var $ = function (id) { return document.getElementById(id); };

  function saveProgress() { localStorage.setItem(LS_PROG, JSON.stringify(progress)); }
  function savePrefs() { localStorage.setItem(LS_PREF, JSON.stringify(prefs)); }

  function curItem() { return queue[pos]; }

  function letterOf(s) {
    var m = (s || '').match(/[A-D]/);
    return m ? m[0] : null;
  }

  function statusOf(id) {
    return (progress[id] && progress[id].s) || null;
  }

  // ---------- 佇列 ----------
  function shuffleArr(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function rebuildQueue() {
    var items = DATA.subjects[prefs.subject].items;
    var q = items.filter(function (it) {
      if (prefs.topic !== 'ALL' && it.topic !== prefs.topic) return false;
      if (prefs.kind !== 'mc' && prefs.kind !== 'sub') { /* ALL */ }
      else if (it.kind !== prefs.kind) return false;
      var s = statusOf(it.id);
      if (prefs.status === 'new' && s) return false;
      if (prefs.status === 'due' && s !== 'bad' && s !== 'half') return false;
      if (prefs.status === 'ok' && s !== 'ok') return false;
      return true;
    });
    if (prefs.shuffle) shuffleArr(q);
    queue = q;
    pos = 0;
  }

  // ---------- 頂欄 / 篩選 ----------
  function renderSubjects() {
    var box = $('subjectSwitch');
    box.innerHTML = '';
    Object.keys(DATA.subjects).forEach(function (code) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = DATA.subjects[code].name;
      if (code === prefs.subject) b.className = 'on';
      b.addEventListener('click', function () {
        if (prefs.subject === code) return;
        prefs.subject = code;
        prefs.topic = 'ALL';
        savePrefs();
        rebuildQueue();
        renderAll();
      });
      box.appendChild(b);
    });
  }

  function chip(label, on, onClick, extra) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (on ? ' on' : '') + (extra ? ' ' + extra : '');
    b.innerHTML = label;
    b.addEventListener('click', onClick);
    return b;
  }

  function renderFilters() {
    var subj = DATA.subjects[prefs.subject];

    var tc = $('topicChips');
    tc.innerHTML = '';
    tc.appendChild(chip('全部課題', prefs.topic === 'ALL', function () {
      prefs.topic = 'ALL'; savePrefs(); rebuildQueue(); renderAll();
    }));
    subj.topics.forEach(function (t) {
      var n = subj.items.filter(function (it) { return it.topic === t.code; }).length;
      tc.appendChild(chip(t.code + ' ' + t.name + '<span class="n">' + n + '</span>',
        prefs.topic === t.code, function () {
          prefs.topic = t.code; savePrefs(); rebuildQueue(); renderAll();
        }));
    });

    var kc = $('kindChips');
    kc.innerHTML = '';
    [['ALL', '全部題型'], ['mc', '選擇題'], ['sub', '主觀題']].forEach(function (p) {
      kc.appendChild(chip(p[1], prefs.kind === p[0], function () {
        prefs.kind = p[0]; savePrefs(); rebuildQueue(); renderAll();
      }));
    });

    var sc = $('statusChips');
    sc.innerHTML = '';
    [['ALL', '全部狀態'], ['new', '未刷'], ['due', '待鞏固'], ['ok', '已征服']].forEach(function (p) {
      sc.appendChild(chip(p[1], prefs.status === p[0], function () {
        prefs.status = p[0]; savePrefs(); rebuildQueue(); renderAll();
      }));
    });

    var sb = $('shuffleBtn');
    sb.classList.toggle('on', prefs.shuffle);
  }

  function renderProgress() {
    var items = DATA.subjects[prefs.subject].items;
    var total = items.length;
    var ok = items.filter(function (it) { return statusOf(it.id) === 'ok'; }).length;
    var due = items.filter(function (it) {
      var s = statusOf(it.id); return s === 'bad' || s === 'half';
    }).length;
    var fresh = total - items.filter(function (it) { return !!statusOf(it.id); }).length;
    $('progressLabel').textContent = '已征服 ' + ok + ' / ' + total;
    $('progressStats').textContent = '待鞏固 ' + due + ' · 未刷 ' + fresh;
    $('progressFill').style.width = (total ? Math.round(ok / total * 100) : 0) + '%';
  }

  // ---------- 卡片 ----------
  function setText(el, text) { el.textContent = text == null ? '' : String(text); }

  function fillLines(el, text) {
    el.innerHTML = '';
    if (!text) { el.textContent = '—'; return; }
    String(text).split('\n').forEach(function (line) {
      var d = document.createElement('div');
      d.className = 'my-line';
      d.textContent = line;
      el.appendChild(d);
    });
  }

  function renderCard() {
    var it = curItem();
    var card = $('card');
    var empty = $('emptyState');
    if (!it) {
      card.hidden = true;
      empty.hidden = false;
      $('prevBtn').disabled = true;
      $('nextBtn').disabled = true;
      return;
    }
    card.hidden = false;
    empty.hidden = true;

    // badges
    var badges = $('cardBadges');
    badges.innerHTML = '';
    var meta = document.createElement('span');
    meta.className = 'badge';
    meta.textContent = it.year + ' ' + it.paper + ' · ' + it.qref;
    badges.appendChild(meta);
    var tn = (DATA.subjects[prefs.subject].topics
      .filter(function (t) { return t.code === it.topic; })[0] || {}).name || '';
    var tb = document.createElement('span');
    tb.className = 'badge b-topic';
    tb.textContent = it.topic + ' ' + tn;
    badges.appendChild(tb);
    var kb = document.createElement('span');
    kb.className = 'badge b-mc';
    kb.textContent = it.kind === 'mc' ? '選擇題' : '主觀題';
    badges.appendChild(kb);

    $('cardPos').textContent = (pos + 1) + ' / ' + queue.length;
    setText($('cardStem'), it.stem);

    // 作答區
    var isMc = it.kind === 'mc';
    $('mcZone').hidden = !isMc;
    $('subZone').hidden = isMc;
    if (isMc) renderMcOptions(it);
    else renderSubZone(it);

    // 答案區重置
    revealed = false;
    mcPick = null;
    $('answerZone').classList.remove('show');
    $('revealBtn').classList.remove('open');

    // 答案內容
    if (isMc) {
      fillLines($('myBody'), it.option || '（當年未作答）');
      setText($('correctBody'), it.correctOpt || '—');
    } else {
      renderMyAnswer(it);
      setText($('correctBody'), it.correct || '—');
    }
    setText($('deductBody'), it.deduct);
    setText($('pointsBody'), it.points);
    ['draftBlock', 'mcJudge'].forEach(function (id) { $(id).hidden = true; });

    // 自評高亮
    var cur = statusOf(it.id);
    document.querySelectorAll('.rate-btn').forEach(function (b) {
      b.classList.toggle('on', b.dataset.s === cur);
    });

    $('prevBtn').disabled = pos === 0;
    $('nextBtn').disabled = pos === queue.length - 1;
  }

  function renderMcOptions(it) {
    var box = $('mcOptions');
    box.innerHTML = '';
    ['A', 'B', 'C', 'D'].forEach(function (l) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'mc-opt';
      b.textContent = l;
      b.dataset.l = l;
      b.addEventListener('click', function () {
        if (revealed) return;
        mcPick = (mcPick === l) ? null : l;
        box.querySelectorAll('.mc-opt').forEach(function (x) {
          x.classList.toggle('picked', x.dataset.l === mcPick);
        });
      });
      box.appendChild(b);
    });
  }

  function renderMyAnswer(it) {
    var el = $('myBody');
    el.innerHTML = '';
    if (!it.my || !it.my.length) { el.textContent = '（無記錄）'; return; }
    it.my.forEach(function (seg) {
      var d = document.createElement('div');
      d.className = 'my-line';
      if (seg[1]) {
        var s = document.createElement('span');
        s.className = 'bad-seg';
        s.textContent = seg[0];
        d.appendChild(s);
      } else {
        d.textContent = seg[0];
      }
      el.appendChild(d);
    });
  }

  function renderSubZone(it) {
    var mode = prefs.answerMode;
    document.querySelectorAll('.mode-btn').forEach(function (b) {
      b.classList.toggle('on', b.dataset.mode === mode);
    });
    $('writeHint').style.display = mode === 'write' ? 'block' : 'none';
    var tb = $('typeBox');
    tb.style.display = mode === 'type' ? 'block' : 'none';
    tb.value = (progress[it.id] && progress[it.id].draft) || '';
  }

  function reveal() {
    var it = curItem();
    if (!it) return;
    revealed = true;
    $('answerZone').classList.add('show');
    $('revealBtn').classList.add('open');

    if (it.kind === 'mc') {
      var correctL = letterOf(it.correctOpt);
      document.querySelectorAll('.mc-opt').forEach(function (b) {
        b.classList.remove('picked');
        if (b.dataset.l === correctL) b.classList.add('correct');
        else if (b.dataset.l === mcPick) b.classList.add('wrong');
      });
      var j = $('mcJudge');
      if (mcPick) {
        var okNow = mcPick === correctL;
        j.hidden = false;
        j.className = 'ans-mc-judge ' + (okNow ? 'j-ok' : 'j-bad');
        j.textContent = okNow
          ? '你選 ' + mcPick + '，正確！'
          : '你選 ' + mcPick + ' · 正解係 ' + correctL;
      }
    } else if (prefs.answerMode === 'type') {
      var draft = (progress[it.id] && progress[it.id].draft) || '';
      if (draft.trim()) {
        $('draftBlock').hidden = false;
        fillLines($('draftBody'), draft);
      }
    }
    // 滾到答案
    setTimeout(function () {
      $('revealBtn').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120);
  }

  function gotoCard(n) {
    if (n < 0 || n >= queue.length) return;
    pos = n;
    renderCard();
    window.scrollTo({ top: $('card').offsetTop - 70, behavior: 'smooth' });
  }

  function renderAll() {
    renderSubjects();
    renderFilters();
    renderProgress();
    renderCard();
  }

  // ---------- 事件 ----------
  $('revealBtn').addEventListener('click', function () {
    if (!revealed) reveal();
    else {
      revealed = false;
      $('answerZone').classList.remove('show');
      $('revealBtn').classList.remove('open');
    }
  });

  $('prevBtn').addEventListener('click', function () { gotoCard(pos - 1); });
  $('nextBtn').addEventListener('click', function () { gotoCard(pos + 1); });

  document.querySelectorAll('.rate-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      var it = curItem();
      if (!it) return;
      var s = b.dataset.s;
      if (!progress[it.id]) progress[it.id] = {};
      if (progress[it.id].s === s) delete progress[it.id].s; // 再按取消
      else progress[it.id].s = s;
      progress[it.id].t = Date.now();
      saveProgress();
      renderProgress();
      renderCard();
    });
  });

  document.querySelectorAll('.mode-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      prefs.answerMode = b.dataset.mode;
      savePrefs();
      renderSubZone(curItem());
    });
  });

  $('shuffleBtn').addEventListener('click', function () {
    prefs.shuffle = !prefs.shuffle;
    savePrefs();
    rebuildQueue();
    renderAll();
  });

  $('typeBox').addEventListener('input', function () {
    var it = curItem();
    if (!it) return;
    var v = $('typeBox').value;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(function () {
      if (!progress[it.id]) progress[it.id] = {};
      progress[it.id].draft = v;
      saveProgress();
    }, 350);
  });

  $('resetBtn').addEventListener('click', function () {
    if (confirm('確定清除呢部裝置上所有作答記錄同自评？')) {
      localStorage.removeItem(LS_PROG);
      localStorage.removeItem(LS_PREF);
      location.reload();
    }
  });

  // 電腦鍵盤快捷鍵：← → 換題、空格翻面、1/2/3 自評（輸入框內不攔截）
  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'textarea' || tag === 'input') return;
    if (e.key === ' ') {
      e.preventDefault();
      $('revealBtn').click();
    } else if (e.key === 'ArrowLeft') {
      $('prevBtn').click();
    } else if (e.key === 'ArrowRight') {
      $('nextBtn').click();
    } else if (revealed && { '1': 'ok', '2': 'half', '3': 'bad' }[e.key]) {
      var b = document.querySelector('.rate-btn[data-s="' + { '1': 'ok', '2': 'half', '3': 'bad' }[e.key] + '"]');
      if (b) b.click();
    }
  });

  // ---------- 啟動 ----------
  rebuildQueue();
  renderAll();
})();
