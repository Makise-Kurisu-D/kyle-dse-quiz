/* Kyle 錯題速記網站 —— 遮答案閃卡（原生 JS，無依賴）
 * MC：原題裁圖（含選項）→ 選字母 → 翻面自動判分
 * 主觀題：紙上/默寫雙模式 → 翻面照踩分點清單自檢（可勾選、覆蓋率、關鍵詞高亮）
 */
(function () {
  'use strict';

  var LS_PROG = 'dse_quiz_progress_v1';
  var LS_PREF = 'dse_quiz_prefs_v1';

  var progress = {};
  var prefs = {
    subject: 'chem', topic: 'ALL', kind: 'ALL', status: 'ALL',
    shuffle: false, answerMode: 'write'
  };
  var queue = [];
  var pos = 0;
  var revealed = false;
  var mcPick = null;

  var $ = function (id) { return document.getElementById(id); };

  function saveProgress() { localStorage.setItem(LS_PROG, JSON.stringify(progress)); }
  function savePrefs() { localStorage.setItem(LS_PREF, JSON.stringify(prefs)); }

  try { progress = JSON.parse(localStorage.getItem(LS_PROG) || '{}') || {}; } catch (e) {}
  try {
    var saved = JSON.parse(localStorage.getItem(LS_PREF) || '{}');
    Object.keys(saved).forEach(function (k) { prefs[k] = saved[k]; });
  } catch (e) {}

  var DATA = window.QUIZ_DATA;

  /* ---------- 佇列 ---------- */
  function rebuildQueue() {
    var items = DATA.subjects[prefs.subject].items;
    var q = items.filter(function (it) {
      if (prefs.topic !== 'ALL' && it.topic !== prefs.topic) return false;
      if (prefs.kind !== 'ALL' && it.kind !== prefs.kind) return false;
      var s = (progress[it.id] || {}).s || null;
      if (prefs.status === 'new' && s) return false;
      if (prefs.status === 'due' && s !== 'half' && s !== 'bad') return false;
      if (prefs.status === 'ok' && s !== 'ok') return false;
      return true;
    });
    if (prefs.shuffle) {
      for (var i = q.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = q[i]; q[i] = q[j]; q[j] = t;
      }
    }
    queue = q;
    pos = 0;
  }

  function statusOf(id) { return (progress[id] && progress[id].s) || null; }
  function letterOf(s) {
    var m = (s || '').match(/[A-D]/);
    return m ? m[0] : null;
  }

  /* ---------- 踩分點關鍵詞 ---------- */
  function keywordsOf(it) {
    var kws = [];
    function add(w) {
      w = w.trim();
      if (w.length >= 2 && kws.indexOf(w) < 0) kws.push(w);
    }
    (it.checks || []).forEach(function (c) {
      var m, re = /「([^」]+)」/g;
      while ((m = re.exec(c))) {
        // 「鋅比鐵活潑（易失電子）」→ 同時收「鋅比鐵活潑」「易失電子」
        add(m[1]);
        m[1].split(/[（）()／\/、，,；;：:]/).forEach(add);
      }
    });
    return kws;
  }

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderCheckText(text, kws) {
    // 「詞」加粗；其餘文本轉義
    var html = '';
    text.split(/「([^」]+)」/).forEach(function (part, i) {
      if (i % 2 === 1) html += '<b class="kw">' + escHtml(part) + '</b>';
      else html += escHtml(part);
    });
    return html;
  }

  function highlightDraft(text, kws) {
    var html = escHtml(text);
    kws.slice().sort(function (a, b) { return b.length - a.length; })
      .forEach(function (kw) {
        var re = new RegExp(escHtml(kw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        html = html.replace(re, '<mark class="kw-hit">$&</mark>');
      });
    return html.split('\n').join('<br>');
  }

  /* ---------- 卡片渲染 ---------- */
  function renderCard() {
    var it = curItem();
    var subj = DATA.subjects[prefs.subject];
    var isMc = it.kind === 'mc';

    var badges = document.createElement('div');
    badges.innerHTML = '';
    var meta = it.year + ' ' + it.paper + ' · ' + it.qref;
    var tn = (subj.topics.filter(function (t) { return t.code === it.topic; })[0] || {}).name || '';
    badges.innerHTML =
      '<span class="badge">' + escHtml(it.year + ' ' + it.paper + ' · ' + it.qref) + '</span>' +
      '<span class="badge b-topic">' + escHtml(it.topic + ' ' + tn) + '</span>' +
      '<span class="badge b-mc">' + (isMc ? '選擇題' : '主觀題') + '</span>';
    $('cardBadges').innerHTML = '';
    $('cardBadges').appendChild(badges);
    $('cardPos').textContent = (pos + 1) + ' / ' + queue.length;

    // 原題圖 / 題幹
    $('qimgZone').hidden = !(isMc && it.img);
    $('stemText').hidden = !(isMc ? !it.img : true);
    if (isMc && it.img) $('qImg').src = it.img;
    $('stemText').textContent = isMc ? it.stem : it.stem;

    $('mcZone').hidden = !isMc;
    $('subZone').hidden = isMc;

    if (isMc) renderMcOptions(it);
    else renderSubZone(it);

    $('answerZone').classList.remove('show');
    revealed = false;
    mcPick = null;
    $('revealBtn').classList.remove('open');

    renderAnswer(it);
    document.querySelectorAll('.rate-btn').forEach(function (b) {
      b.classList.toggle('on', statusOf(it.id) === b.dataset.s);
    });
    renderProgress();
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
        if (mcPick) reveal();
      });
      box.appendChild(b);
    });
  }

  function renderSubZone(it) {
    var mode = prefs.answerMode;
    document.querySelectorAll('.mode-btn').forEach(function (b) {
      b.classList.toggle('on', b.dataset.mode === mode);
    });
    $('writeHint').style.display = (mode === 'write') ? 'block' : 'none';
    $('typeBox').style.display = (mode === 'type') ? 'block' : 'none';
    $('typeBox').value = (progress[it.id] && progress[it.id].draft) || '';
  }

  function renderMyAnswer(it) {
    var el = $('myBody');
    if (it.kind === 'mc') {
      el.textContent = (it.option && it.option.indexOf('未作答') < 0)
        ? '當年你揀：' + it.option : '（當年未作答）';
      return;
    }
    if (!it.my) { el.textContent = '（當年未作答）'; return; }
    el.innerHTML = '';
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

  function renderChecklist(it) {
    var block = $('checksBlock');
    if (it.kind !== 'sub' || !it.checks || !it.checks.length) {
      block.hidden = true;
      return;
    }
    block.hidden = false;
    var kws = keywordsOf(it);
    var saved = progress[it.id] && progress[it.id].checks;
    var list = $('checkList');
    list.innerHTML = '';
    it.checks.forEach(function (text, i) {
      var lab = document.createElement('label');
      lab.className = 'chk-line';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!(saved && saved[i]);
      cb.addEventListener('change', function () {
        var p = progress[it.id] || {};
        var arr = it.checks.map(function (_, j) {
          return j === i ? cb.checked : (p.checks && p.checks[j]) || false;
        });
        progress[it.id] = Object.assign(p, { checks: arr });
        saveProgress();
        updateCover(it);
      });
      var span = document.createElement('span');
      span.className = 'chk-text';
      span.innerHTML = renderCheckText(text, kws);
      lab.appendChild(cb);
      lab.appendChild(span);
      list.appendChild(lab);
    });
    updateCover(it);
  }

  function updateCover(it) {
    var boxes = $('checkList').querySelectorAll('input[type=checkbox]');
    var n = boxes.length, got = 0;
    boxes.forEach(function (b) { if (b.checked) got++; });
    var el = $('checkCover');
    el.className = 'check-cover' + (got === n ? ' all' : (got >= Math.ceil(n * 0.6) ? ' most' : ''));
    el.textContent = '踩到 ' + got + ' / ' + n + ' 個給分點' +
      (got === n ? '　✅ 全部覆蓋！' : (got === 0 ? '（紙上作答也要誠實自評）' : ''));
  }

  function renderAnswer(it) {
    var kws = keywordsOf(it);

    // 默寫稿（含關鍵詞命中高亮）
    var draft = (progress[it.id] && progress[it.id].draft) || '';
    if (draft.trim()) {
      $('draftBlock').hidden = false;
      $('draftBody').innerHTML = highlightDraft(draft, kws);
    } else {
      $('draftBlock').hidden = true;
    }

    // MC 判定條
    var j = $('mcJudge');
    j.hidden = true;

    renderMyAnswer(it);
    setText($('deductBody'), it.deduct);
    if (it.kind === 'mc') {
      setText($('correctBody'), it.correctOpt || '—');
    } else {
      setText($('correctBody'), it.correct || '—');
    }
    setText($('pointsBody'), it.points);
    renderChecklist(it);
  }

  function setText(el, text) {
    el.innerHTML = '';
    el.appendChild(document.createTextNode(text == null ? '—' : text));
  }

  function curItem() { return queue[pos]; }

  function gotoCard(n) {
    if (n < 0 || n >= queue.length) return;
    pos = n;
    renderCard();
    window.scrollTo({ top: $('card').offsetTop - 70, behavior: 'smooth' });
  }

  /* ---------- 翻面 ---------- */
  function reveal() {
    var it = curItem();
    revealed = true;
    $('answerZone').classList.add('show');
    $('revealBtn').classList.add('open');
    if (it.kind !== 'mc') {
      // 主觀題：翻面前可能已輸入默寫，此處即時生成稿塊＋高亮
      var draft = (progress[it.id] && progress[it.id].draft) || '';
      $('draftBlock').hidden = !draft.trim();
      if (draft.trim()) {
        $('draftBody').innerHTML = highlightDraft(draft, keywordsOf(it));
      }
    }
    if (it.kind === 'mc') {
      var correctL = letterOf(it.correctOpt);
      if (mcPick && correctL) {
        var j = $('mcJudge');
        j.hidden = false;
        j.className = 'ans-block ans-mc-judge ' + (mcPick === correctL ? 'j-ok' : 'j-bad');
        j.textContent = mcPick === correctL
          ? '你選 ' + mcPick + '，正確！'
          : '你選 ' + mcPick + ' · 正解係 ' + correctL;
        document.querySelectorAll('.mc-opt').forEach(function (b) {
          var l = b.dataset.l;
          if (l === correctL) b.classList.add('correct');
          if (l === mcPick && mcPick !== correctL) b.classList.add('wrong');
          if (l !== mcPick && l !== correctL) b.classList.add('faded');
        });
      }
    }
    setTimeout(function () {
      $('answerZone').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
  }

  /* ---------- 主體渲染 ---------- */
  function renderSubjects() {
    var box = $('subjectSwitch');
    box.innerHTML = '';
    Object.keys(DATA.subjects).forEach(function (code) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = DATA.subjects[code].name;
      b.className = code === prefs.subject ? 'on' : '';
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

  function renderFilters() {
    var tc = $('topicChips');
    tc.innerHTML = '';
    var subj = DATA.subjects[prefs.subject];
    appendChip(tc, 'ALL', '全部課題', prefs.topic === 'ALL', function () {
      prefs.topic = 'ALL'; savePrefs(); rebuildQueue(); renderAll();
    });
    subj.topics.forEach(function (t) {
      var n = subj.items.filter(function (it) { return it.topic === t.code; }).length;
      appendChip(tc, t.code, t.code + ' ' + t.name + '<span class="n">' + n + '</span>',
        prefs.topic === t.code, function () {
          prefs.topic = t.code; savePrefs(); rebuildQueue(); renderAll();
        });
    });

    var kc = $('kindChips');
    kc.innerHTML = '';
    [['ALL', '全部題型'], ['mc', '選擇題'], ['sub', '主觀題']].forEach(function (p) {
      appendChip(kc, p[0], p[1], prefs.kind === p[0], function () {
        prefs.kind = p[0]; savePrefs(); rebuildQueue(); renderAll();
      });
    });

    var sc = $('statusChips');
    sc.innerHTML = '';
    [['ALL', '全部狀態'], ['new', '未刷'], ['due', '待鞏固'], ['ok', '已征服']].forEach(function (p) {
      appendChip(sc, p[0], p[1], prefs.status === p[0], function () {
        prefs.status = p[0]; savePrefs(); rebuildQueue(); renderAll();
      });
    });

    var sb = $('shuffleBtn');
    sb.classList.toggle('on', prefs.shuffle);
  }

  function appendChip(parent, label, html, on, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (on ? ' on' : '');
    b.innerHTML = html;
    b.addEventListener('click', onClick);
    parent.appendChild(b);
  }

  function renderProgress() {
    var items = DATA.subjects[prefs.subject].items;
    var total = items.length;
    var ok = items.filter(function (it) { return statusOf(it.id) === 'ok'; }).length;
    var due = items.filter(function (it) {
      var s = statusOf(it.id); return s === 'bad' || s === 'half';
    }).length;
    var fresh = items.filter(function (it) { return !statusOf(it.id); }).length;
    $('progressLabel').textContent = '已征服 ' + ok + ' / ' + total;
    $('progressStats').textContent = '待鞏固 ' + due + ' · 未刷 ' + fresh;
    var fill = (total ? Math.round(ok / total * 100) : 0);
    $('progressFill').style.width = fill + '%';
  }

  function renderAll() {
    renderSubjects();
    renderFilters();
    renderProgress();
    if (queue.length) renderCard();
    var empty = $('emptyState');
    var stage = $('stage');
    empty.hidden = !!queue.length;
    stage.hidden = !queue.length;
    $('prevBtn').disabled = pos === 0;
    $('nextBtn').disabled = pos === queue.length - 1;
  }

  /* ---------- 事件 ---------- */
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

  document.querySelectorAll('.mode-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      prefs.answerMode = b.dataset.mode;
      savePrefs();
      renderSubZone(curItem());
    });
  });

  $('typeBox').addEventListener('input', function () {
    var it = curItem();
    var v = $('typeBox').value;
    progress[it.id] = Object.assign(progress[it.id] || {}, { draft: v });
    saveProgress();
    // 即時高亮（已翻面時）
    if (revealed) {
      var kws = keywordsOf(it);
      $('draftBlock').hidden = !v.trim();
      $('draftBody').innerHTML = highlightDraft(v, kws);
    }
  });

  document.querySelectorAll('.rate-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      var it = curItem();
      var s = b.dataset.s;
      var p = progress[it.id] || {};
      if (p.s === s) { delete p.s; } else { p.s = s; }
      if (Object.keys(p).length) progress[it.id] = p;
      else delete progress[it.id];
      saveProgress();
      renderCard();
    });
  });

  $('resetBtn').addEventListener('click', function () {
    if (confirm('確定清除呢部裝置上所有作答同記錄（含踩分點勾選）？')) {
      localStorage.removeItem(LS_PROG);
      progress = {};
      location.reload();
    }
  });

  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'textarea' || tag === 'input') return;
    if (e.key === ' ') {
      e.preventDefault();
      if (!revealed) $('revealBtn').click();
    } else if (e.key === 'ArrowLeft') {
      $('prevBtn').click();
    } else if (e.key === 'ArrowRight') {
      $('nextBtn').click();
    } else if (revealed && { '1': 'ok', '2': 'half', '3': 'bad' }[e.key]) {
      var b = document.querySelector('.rate-btn[data-s="' + { '1': 'ok', '2': 'half', '3': 'bad' }[e.key] + '"]');
      if (b) b.click();
    }
  });

  /* ---------- 啟動 ---------- */
  rebuildQueue();
  renderAll();
})();
