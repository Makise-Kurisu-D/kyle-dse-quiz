/* Kyle 錯題本 —— 純靜態 SPA（hash 路由，localStorage 儲存，無依賴）
 * 視圖：主頁 / 練習（課題排序）/ 做題會話（一次提交、MC 自動批改、大題踩分點自改）/ 記錄（熱力圖＋仍錯查詢）
 */
(function () {
  'use strict';
  var DATA = window.QUIZ_DATA;
  var LS_SESS = 'dse_quiz_sessions_v2';
  var LS_DRAFT = 'dse_quiz_draft_v2';

  var sessions = load(LS_SESS, []);
  var drafts = load(LS_DRAFT, {});
  var SUBJECT_ORDER = ['chem', 'bio'];
  var SUBJECT_META = {
    chem: { name: '化學', icon: '⚗️', soon: false },
    bio: { name: '生物', icon: '🧬', soon: false },
    math: { name: '數學', icon: '📐', soon: true }
  };

  function load(k, d) {
    try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; }
    catch (e) { return d; }
  }
  function save() {
    localStorage.setItem(LS_SESS, JSON.stringify(sessions));
    localStorage.setItem(LS_DRAFT, JSON.stringify(drafts));
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---------------- 數據派生 ---------------- */
  function subjOf(code) { return DATA.subjects[code]; }
  function itemsOf(code) { return subjOf(code).items; }
  function topicName(code, t) {
    var x = subjOf(code).topics.filter(function (q) { return q.code === t; })[0];
    return x ? x.name : t;
  }
  function marksOf(it) {
    if (it.kind === 'mc') return 1;
    var m = (it.qref || '').match(/（\s*([0-9]+(?:\.[0-9]+)?)\s*分/);
    return m ? parseFloat(m[1]) : (it.checks ? it.checks.length : 1);
  }
  function letterOf(s) { var m = (s || '').match(/[A-D]/); return m ? m[0] : null; }

  // 每個課題的失分總和（＝錯題分值）與題數
  function topicStats(code) {
    var out = {};
    itemsOf(code).forEach(function (it) {
      if (!out[it.topic]) out[it.topic] = { topic: it.topic, marks: 0, n: 0 };
      out[it.topic].marks += marksOf(it);
      out[it.topic].n += 1;
    });
    return out;
  }

  // 最近一次各題表現：id → {ok, ratio, date, subj, topic}
  function latestMap() {
    var map = {};
    sessions.slice().sort(function (a, b) { return a.t - b.t; }).forEach(function (s) {
      Object.keys(s.results).forEach(function (id) {
        var r = s.results[id];
        map[id] = {
          ok: r.ok, ratio: r.tot ? r.marks / r.tot : (r.ok ? 1 : 0),
          date: s.t, subj: s.subj, topic: s.topic
        };
      });
    });
    return map;
  }
  function isWrong(latest) {
    if (!latest) return true;            // 從未刷過＝待處理
    if (latest.ok === true) {
      // 大題全對才算 ok；MC ok=true 即對
      return latest.ratio < 0.6;
    }
    return true;
  }
  function dueCount(code, topic, latest) {
    return itemsOf(code).filter(function (it) {
      return it.topic === topic && isWrong(latest[it.id]);
    }).length;
  }

  // 簡體→繁體（數據裡少量簡體術語，學生默寫多為繁體；只收斂到繁體）
  var S2T_CHARS = '细质线双补转录应达尔体肠运输长营养纤维粪传杂种叶绿矿气压脏脑岛门静脉韧卫饱缩横肾茎腾浓';
  var S2T_MAP = {
    '细':'細','质':'質','线':'線','双':'雙','补':'補','转':'轉','录':'錄','应':'應',
    '达':'達','尔':'爾','体':'體','肠':'腸','运':'運','输':'輸','长':'長','营':'營',
    '养':'養','纤':'纖','维':'維','粪':'糞','遗':'遺','传':'傳','杂':'雜','种':'種',
    '态':'態','叶':'葉','绿':'綠','矿':'礦','气':'氣','压':'壓','脏':'臟','脑':'腦',
    '岛':'島','门':'門','静':'靜','脉':'脈','韧':'韌','卫':'衛','饱':'飽','缩':'縮',
    '横':'橫','肾':'腎','茎':'莖','腾':'騰','浓':'濃'
  };
  function norm(s) {
    return String(s).replace(new RegExp('[' + S2T_CHARS + ']', 'g'),
      function (ch) { return S2T_MAP[ch] || ch; });
  }

  var KW_ALIAS = { '蛋白合成': ['蛋白質合成'], '蛋白': ['蛋白質'] };
  function keywordsOf(it) {
    var kws = [];
    function add(w) {
      w = norm(w.trim());
      [w].concat(KW_ALIAS[w] || []).forEach(function (v) {
        if (v.length >= 2 && kws.indexOf(v) < 0) kws.push(v);
      });
    }
    (it.checks || []).forEach(function (c) {
      var m, re = /「([^」]+)」/g;
      while ((m = re.exec(c))) {
        add(m[1]);
        m[1].split(/[（）()／\/、，,；;：:]/).forEach(add);
      }
    });
    return kws;
  }
  function highlight(text, kws) {
    var html = esc(norm(text));
    kws.slice().sort(function (a, b) { return b.length - a.length; }).forEach(function (kw) {
      var re = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      html = html.replace(re, '<mark class="kw-hit">$&</mark>');
    });
    return html.split('\n').join('<br>');
  }

  /* ---------------- 路由 ---------------- */
  function route() {
    var h = location.hash.replace(/^#/, '') || '/';
    var parts = h.split('/').filter(Boolean);
    var view = parts[0] || 'home';
    $all('.rail-item,.tab-item').forEach(function (a) {
      a.classList.toggle('active', a.dataset.route === view);
    });
    window.scrollTo(0, 0);
    if (view === 'home') return renderHome();
    if (view === 'practice') return renderPractice(parts[1] || 'chem');
    if (view === 'session') return renderSession(parts[1], decodeURIComponent(parts[2] || ''));
    if (view === 'records') return renderRecords();
    renderHome();
  }
  window.addEventListener('hashchange', route);

  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._tm);
    toast._tm = setTimeout(function () { t.hidden = true; }, 2200);
  }

  /* ---------------- 主頁 ---------------- */
  function renderHome() {
    var latest = latestMap();
    var totalItems = SUBJECT_ORDER.reduce(function (n, c) { return n + itemsOf(c).length; }, 0);
    var doneIds = {}; sessions.forEach(function (s) {
      Object.keys(s.results).forEach(function (id) { doneIds[id] = s.results[id]; });
    });
    var conquered = Object.keys(doneIds).filter(function (id) {
      var r = doneIds[id];
      return r.ok === true && (r.tot ? r.marks / r.tot >= 0.99 : true);
    }).length;
    var due = totalItems - conquered;

    // 推薦課題：全部科目合併，按失分排序，取仍有未清錯題的前三
    var recs = [];
    SUBJECT_ORDER.forEach(function (code) {
      var st = topicStats(code);
      Object.keys(st).forEach(function (t) {
        recs.push({
          code: code, topic: t, marks: st[t].marks, n: st[t].n,
          due: dueCount(code, t, latest)
        });
      });
    });
    recs.sort(function (a, b) { return (b.due > 0 ? b.marks : -1) - (a.due > 0 ? a.marks : -1) || b.marks - a.marks; });
    var top = recs.slice(0, 3);

    $('#app').innerHTML =
      '<section class="home">' +
        '<div class="hero">' +
          '<div class="hero-kicker">DSE · 化學 / 生物</div>' +
          '<h1 class="hero-title">Kyle 嘅錯題本</h1>' +
          '<p class="hero-sub">錯過嘅唔可以再錯 —— 逐課題清，每個踩分點都執返。</p>' +
          '<div class="hero-stat">' +
            '<span><b>' + totalItems + '</b> 題在庫</span>' +
            '<span><b class="c-green">' + conquered + '</b> 已征服</span>' +
            '<span><b class="c-red">' + due + '</b> 待清</span>' +
          '</div>' +
        '</div>' +

        '<div class="tile-grid">' +
          tile('#/practice/chem', '✏️', '開始練習', '按課題失分由高到低排，逐個擊破', 'tile-blue') +
          tile('#/records', '📈', '做題記錄', '刷題熱力圖＋分數走勢', 'tile-gold') +
          tile('#/session/chem/' + encodeURIComponent('__random__'), '🎲', '隨機十題', '化學錯題隨機抽 10 題速測', 'tile-green') +
        '</div>' +

        '<div class="home-sec">' +
          '<div class="home-sec-h"><h2>🔥 建議優先複習</h2><a class="link" href="#/practice/chem">全部課題 →</a></div>' +
          '<div class="rec-grid">' +
            top.map(function (r) {
              var pct = pctOf(r.code, r.marks);
              return '<a class="rec-card" href="#/session/' + r.code + '/' + encodeURIComponent(r.topic) + '">' +
                '<div class="rec-top"><span class="rec-subj">' + SUBJECT_META[r.code].icon + ' ' +
                  esc(SUBJECT_META[r.code].name) + '</span>' +
                  (r.due ? '<span class="rec-due">待清 ' + r.due + '</span>' : '<span class="rec-ok">已清 ✔</span>') +
                '</div>' +
                '<div class="rec-name">' + esc(r.topic + ' ' + topicName(r.code, r.topic)) + '</div>' +
                '<div class="rec-bar"><i style="width:' + pct + '"></i></div>' +
                '<div class="rec-meta">' + r.n + ' 題錯 · 失分 ' + r.marks + ' 分 · 佔該科 ' + pct + '</div>' +
              '</a>';
            }).join('') +
          '</div>' +
        '</div>' +
      '</section>';
  }
  function tile(href, ico, title, desc, cls) {
    return '<a class="tile ' + cls + '" href="' + href + '">' +
      '<div class="tile-ico">' + ico + '</div>' +
      '<div class="tile-body"><div class="tile-title">' + title + '</div>' +
      '<div class="tile-desc">' + desc + '</div></div>' +
      '<div class="tile-arrow">→</div></a>';
  }
  function pctOf(code, marks) {
    var st = topicStats(code);
    var all = Object.keys(st).reduce(function (s, t) { return s + st[t].marks; }, 0);
    return Math.round(marks / all * 100) + '%';
  }

  /* ---------------- 練習頁：科目切換＋課題排序 ---------------- */
  function renderPractice(code) {
    if (SUBJECT_META[code] && SUBJECT_META[code].soon) {
      $('#app').innerHTML = '<section class="page"><div class="soon-banner">📐 ' +
        esc(SUBJECT_META[code].name) + ' 錯題庫即將推出，考完好試卷就會自動出現。</div>' +
        '<a class="btn btn-primary" href="#/practice/chem">← 返化學</a></section>';
      return;
    }
    if (!subjOf(code)) code = 'chem';
    var st = topicStats(code), latest = latestMap();
    var totalMarks = Object.keys(st).reduce(function (s, t) { return s + st[t].marks; }, 0);
    var rows = Object.keys(st).map(function (t) {
      return { topic: t, marks: st[t].marks, n: st[t].n, due: dueCount(code, t, latest) };
    }).sort(function (a, b) {
      // 有待清的先排，其內按失分降序
      if ((a.due > 0) !== (b.due > 0)) return a.due > 0 ? -1 : 1;
      return b.marks - a.marks;
    });

    var tabs = ['chem', 'bio', 'math'].map(function (c) {
      var m = SUBJECT_META[c];
      if (m.soon) {
        return '<button class="subj-tab is-soon" type="button" disabled>' +
          m.icon + ' ' + m.name + '<small>即將</small></button>';
      }
      return '<a class="subj-tab' + (c === code ? ' on' : '') + '" href="#/practice/' + c + '">' +
        m.icon + ' ' + m.name + '</a>';
    }).join('');

    $('#app').innerHTML =
      '<section class="page">' +
        '<header class="page-head">' +
          '<div><h1 class="page-title">' + SUBJECT_META[code].icon + ' ' + esc(subjOf(code).name) + '練習</h1>' +
          '<p class="page-sub">按每個課題嘅失分同佔比排序，失分越多排越前。</p></div>' +
          '<a class="btn btn-ghost" href="#/">← 主頁</a>' +
        '</header>' +
        '<div class="subj-tabs">' + tabs + '</div>' +
        '<div class="topic-list">' +
          rows.map(function (r, i) {
            var pct = Math.round(r.marks / totalMarks * 100);
            return '<a class="topic-card' + (r.due ? '' : ' is-clear') + '" ' +
              'href="#/session/' + code + '/' + encodeURIComponent(r.topic) + '">' +
              '<div class="topic-rank rank-' + Math.min(i + 1, 4) + '">' + (i + 1) + '</div>' +
              '<div class="topic-main">' +
                '<div class="topic-name">' + esc(r.topic + ' ' + topicName(code, r.topic)) + '</div>' +
                '<div class="topic-bar"><i style="width:' + pct + '%"></i></div>' +
                '<div class="topic-meta">' + r.n + ' 道錯題 · 失分 <b>' + r.marks + '</b> 分 · 佔比 ' + pct + '%</div>' +
              '</div>' +
              '<div class="topic-side">' +
                (r.due ? '<span class="pill pill-red">待清 ' + r.due + '</span>'
                       : '<span class="pill pill-green">已清 ✔</span>') +
                '<span class="topic-go">開始 →</span>' +
              '</div>' +
            '</a>';
          }).join('') +
        '</div>' +
        '<a class="btn btn-random" href="#/session/' + code + '/' + encodeURIComponent('__random__') +
          '">🎲 隨機抽 10 題速測</a>' +
      '</section>';
  }

  /* ---------------- 做題會話 ---------------- */
  var reviewState = null;   // 提交後的批改結果

  function sessionItems(code, topic) {
    var all = itemsOf(code).filter(function (it) { return it.topic === topic; });
    if (topic === '__random__') {
      all = itemsOf(code).slice();
      for (var i = all.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1)), t = all[i]; all[i] = all[j]; all[j] = t;
      }
      all = all.slice(0, 10);
    }
    return all;
  }

  function renderSession(code, topic) {
    if (!subjOf(code) || !topic) { location.hash = '#/practice'; return; }
    var items = sessionItems(code, topic);
    if (!items.length) { location.hash = '#/practice/' + code; return; }
    var dkey = code + ':' + topic + (topic === '__random__' ? ':' + items.map(function (i) { return i.id; }).join(',') : '');
    var draft = drafts[dkey] || { pick: {}, text: {}, paper: {} };
    reviewState = null;

    var title = topic === '__random__' ? '🎲 隨機十題' : esc(topic + ' ' + topicName(code, topic));
    $('#app').innerHTML =
      '<section class="page session" data-key="' + esc(dkey) + '" data-code="' + code + '" data-topic="' + esc(topic) + '">' +
        '<header class="page-head">' +
          '<div><h1 class="page-title">' + SUBJECT_META[code].icon + ' ' + title + '</h1>' +
          '<p class="page-sub"><span id="answeredCount">0</span> / ' + items.length + ' 題已作答 · ' +
            'MC 自動批改，大題照踩分點自己勾分</p></div>' +
          '<a class="btn btn-ghost" href="#/practice/' + code + '">← 離開</a>' +
        '</header>' +
        '<div class="q-paper" id="qPaper">' +
          items.map(function (it, idx) { return questionHtml(it, idx, draft); }).join('') +
        '</div>' +
        '<div class="submit-bar" id="submitBar">' +
          '<button class="btn btn-primary btn-lg" id="submitBtn" type="button">✅ 全部做完，一次過提交</button>' +
        '</div>' +
        '<div class="result-panel" id="resultPanel" hidden></div>' +
      '</section>';

    bindSession(code, topic, dkey, items);
  }

  function questionHtml(it, idx, draft) {
    var head =
      '<div class="sq-head">' +
        '<span class="sq-no">' + (idx + 1) + '</span>' +
        '<span class="sq-badge">' + esc(it.year + ' ' + it.paper + ' · ' + it.qref) + '</span>' +
        '<span class="sq-kind ' + (it.kind === 'mc' ? 'k-mc' : 'k-sub') + '">' +
          (it.kind === 'mc' ? '選擇 ' + marksOf(it) + ' 分' : '大題 ' + marksOf(it) + ' 分') + '</span>' +
      '</div>';

    var body = '';
    if (it.kind === 'mc') {
      var picked = draft.pick[it.id] || '';
      body =
        (it.img ? '<img class="q-img" src="' + esc(it.img) + '" alt="原題裁圖">' :
                  '<div class="q-stem">' + esc(it.stem) + '</div>') +
        '<div class="opts" data-id="' + esc(it.id) + '">' +
          ['A', 'B', 'C', 'D'].map(function (l) {
            return '<button type="button" class="opt' + (picked === l ? ' picked' : '') +
              '" data-l="' + l + '">' + l + '</button>';
          }).join('') +
        '</div>';
    } else {
      var v = draft.text[it.id] || '';
      body =
        '<div class="q-stem">' + esc(it.stem) + '</div>' +
        '<textarea class="ans-box" data-id="' + esc(it.id) + '" rows="4" ' +
          'placeholder="默寫答案（可留白，改用紙寫就剔下面格仔）……">' + esc(v) + '</textarea>' +
        '<label class="paper-lbl"><input type="checkbox" class="paper-chk" data-id="' + esc(it.id) + '"' +
          (draft.paper[it.id] ? ' checked' : '') + '> 我已喺紙上寫完</label>';
    }
    return '<article class="sq" data-id="' + esc(it.id) + '" data-kind="' + it.kind + '">' + head + body + '</article>';
  }

  function bindSession(code, topic, dkey, items) {
    var draft = drafts[dkey] || { pick: {}, text: {}, paper: {} };
    function persist() { drafts[dkey] = draft; save(); updateAnswered(); }
    function answeredCount() {
      return items.filter(function (it) {
        if (it.kind === 'mc') return !!draft.pick[it.id];
        return (draft.text[it.id] && draft.text[it.id].trim()) || draft.paper[it.id];
      }).length;
    }
    function updateAnswered() { $('#answeredCount').textContent = answeredCount(); }
    updateAnswered();

    $all('.opts', $('#app')).forEach(function (box) {
      box.addEventListener('click', function (e) {
        if (reviewState) return;
        var b = e.target.closest('.opt'); if (!b) return;
        var id = box.dataset.id, l = b.dataset.l;
        draft.pick[id] = (draft.pick[id] === l) ? '' : l;
        $all('.opt', box).forEach(function (x) {
          x.classList.toggle('picked', x.dataset.l === draft.pick[id]);
        });
        persist();
      });
    });
    $all('.ans-box', $('#app')).forEach(function (ta) {
      ta.addEventListener('input', function () { draft.text[ta.dataset.id] = ta.value; persist(); });
    });
    $all('.paper-chk', $('#app')).forEach(function (cb) {
      cb.addEventListener('change', function () { draft.paper[cb.dataset.id] = cb.checked; persist(); });
    });

    $('#submitBtn').addEventListener('click', function () {
      var miss = items.filter(function (it) {
        if (it.kind === 'mc') return !draft.pick[it.id];
        return !((draft.text[it.id] && draft.text[it.id].trim()) || draft.paper[it.id]);
      });
      if (miss.length) {
        toast('仲有 ' + miss.length + ' 題未作答（MC 要揀，大題要默寫或剔紙上寫完）');
        var el = $('.sq[data-id="' + miss[0].id + '"]');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      submitSession(code, topic, dkey, items, draft);
    });
  }

  /* ---------- 提交批改 ---------- */
  function submitSession(code, topic, dkey, items, draft) {
    reviewState = { results: {} };
    var mcFull = 0, mcMarks = 0, subFull = 0;

    items.forEach(function (it) {
      if (it.kind === 'mc') {
        var correctL = letterOf(it.correctOpt);
        var picked = draft.pick[it.id] || '';
        var ok = picked === correctL;
        mcFull += 1; mcMarks += ok ? 1 : 0;
        reviewState.results[it.id] = { kind: 'mc', picked: picked, ok: ok, marks: ok ? 1 : 0, tot: 1 };
      } else {
        subFull += marksOf(it);
      }
    });

    // 渲染批改面板（MC 直接出結果；大題出踩分點表單）
    var html = '<div class="rp-head">' +
      '<h2>📋 批改結果（MC 已自動改，大題自己照踩分點剔分）</h2>' +
      '<div class="rp-score">MC <b id="mcScore">' + mcMarks + ' / ' + mcFull + '</b> 分' +
      '　·　大題 <b id="subScore">0 / ' + subFull + '</b> 分' +
      '　·　總分 <b id="allScore">' + mcMarks + ' / ' + (mcFull + subFull) + '</b></div></div>';

    items.forEach(function (it, idx) {
      html += '<article class="rq ' + (it.kind === 'mc' ? 'rq-mc' : 'rq-sub') + '" data-id="' + esc(it.id) + '">';
      html += '<div class="sq-head"><span class="sq-no">' + (idx + 1) + '</span>' +
        '<span class="sq-badge">' + esc(it.qref) + '</span></div>';

      if (it.kind === 'mc') {
        var correctL = letterOf(it.correctOpt), picked = draft.pick[it.id];
        var ok = picked === correctL;
        html += '<div class="judge ' + (ok ? 'j-ok' : 'j-bad') + '">' +
          (ok ? '✅ 答對（' + picked + '）' : '❌ 你揀 ' + picked + ' · 正解 ' + correctL) + '</div>' +
          answerBlocks(it, false, '');
      } else {
        var draftText = draft.text[it.id] || '';
        if (draftText.trim()) {
          html += '<div class="ans-block ans-type"><div class="ans-title">✍️ 你今次默寫</div>' +
            '<div class="ans-body">' + highlight(draftText, keywordsOf(it)) + '</div></div>';
        }
        html += answerBlocks(it, true, '');
        var checks = it.checks || [];
        html += '<div class="chk-form" data-id="' + esc(it.id) + '" data-marks="' + marksOf(it) + '">' +
          '<div class="chk-form-h">🎯 你寫到邊個踩分點？（剔中 ' +
            '<span class="chk-got">0</span>/<span class="chk-tot">' + checks.length + '</span>' +
            '　→　<b class="chk-score">0</b>/' + marksOf(it) + ' 分）</div>' +
          checks.map(function (c, i) {
            return '<label class="chk-line"><input type="checkbox" data-i="' + i + '">' +
              '<span class="chk-text">' + checkText(c) + '</span></label>';
          }).join('') + '</div>';
      }
      html += '</article>';
    });

    html += '<div class="rp-actions">' +
      '<button class="btn btn-primary btn-lg" id="saveSessionBtn" type="button">💾 儲存做題記錄</button>' +
      '<a class="btn btn-ghost" href="#/practice/' + code + '">返課題列表</a></div>';

    var panel = $('#resultPanel');
    panel.hidden = false;
    panel.innerHTML = html;
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

    function recalcSub() {
      var got = 0;
      $all('.chk-form', panel).forEach(function (f) {
        var n = $all('input:checked', f).length;
        var tot = $all('input', f).length;
        var sc = tot ? Math.round(parseFloat(f.dataset.marks) * n / tot) : 0;
        $('.chk-got', f).textContent = n;
        $('.chk-score', f).textContent = sc;
        reviewState.results[f.dataset.id] = {
          kind: 'sub', marks: sc, tot: parseFloat(f.dataset.marks),
          ok: sc >= parseFloat(f.dataset.marks)
        };
        got += sc;
      });
      $('#subScore').innerHTML = '';
      $('#subScore').appendChild(document.createElement('b')).textContent = got + ' / ' + subFull;
      $('#allScore').innerHTML = '';
      $('#allScore').appendChild(document.createElement('b')).textContent =
        (mcMarks + got) + ' / ' + (mcFull + subFull);
    }
    $all('.chk-form input', panel).forEach(function (cb) {
      cb.addEventListener('change', recalcSub);
    });

    $('#saveSessionBtn').addEventListener('click', function () {
      // 落齊大題結果（未剔任何項也要存 0 分）
      items.forEach(function (it) {
        if (it.kind !== 'sub') return;
        var f = $('.chk-form[data-id="' + it.id + '"]', panel);
        var n = $all('input:checked', f).length;
        var tot = $all('input', f).length;
        var sc = tot ? Math.round(marksOf(it) * n / tot) : 0;
        reviewState.results[it.id] = {
          kind: 'sub', marks: sc, tot: marksOf(it), ok: sc >= marksOf(it),
          got: n, checks: tot
        };
      });
      var subGotFinal = Object.keys(reviewState.results).reduce(function (s, id) {
        var r = reviewState.results[id];
        return s + (r.kind === 'sub' ? r.marks : 0);
      }, 0);
      sessions.push({
        t: Date.now(), subj: code, topic: topic,
        results: reviewState.results,
        mc: mcMarks + '/' + mcFull, sub: subGotFinal + '/' + subFull
      });
      delete drafts[dkey];
      save();
      var pct = Math.round((mcMarks + subGotFinal) / (mcFull + subFull) * 100);
      panel.innerHTML =
        '<div class="saved-card">' +
          '<div class="saved-emoji">🎉</div>' +
          '<h2>已存入做題記錄</h2>' +
          '<div class="saved-score">' + (mcMarks + subGotFinal) + ' / ' + (mcFull + subFull) +
            ' 分（' + pct + '%）</div>' +
          '<div class="saved-sub">MC ' + mcMarks + '/' + mcFull + '　大題 ' + subGotFinal + '/' + subFull + '</div>' +
          '<div class="rp-actions"><a class="btn btn-primary" href="#/records">📈 睇記錄</a>' +
          '<a class="btn btn-ghost" href="#/practice/' + code + '">繼續練習 →</a></div>' +
        '</div>';
      panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
      toast('記錄已儲存 ✔');
    });
  }

  function checkText(text) {
    var html = '';
    text.split(/「([^」]+)」/).forEach(function (p, i) {
      html += (i % 2 === 1) ? '<b class="kw">' + esc(p) + '</b>' : esc(p);
    });
    return html;
  }
  function answerBlocks(it, withMine, draftHtml) {
    var h = '';
    if (withMine && it.my && it.my.length) {
      h += '<div class="ans-block ans-mine"><div class="ans-title">📝 你當年嘅答案</div><div class="ans-body">' +
        it.my.map(function (s) {
          return s[1] ? '<span class="bad-seg">' + esc(s[0]) + '</span>' : esc(s[0]);
        }).join('<br>') + '</div></div>';
    }
    if (it.kind === 'mc') {
      h += '<div class="ans-block ans-mine"><div class="ans-title">📝 當年你揀</div>' +
        '<div class="ans-body">' + esc(it.option || '—') + '</div></div>';
    }
    h += '<div class="ans-block ans-deduct"><div class="ans-title">❌ 錯因分析</div>' +
      '<div class="ans-body">' + esc(it.deduct || '—') + '</div></div>';
    h += '<div class="ans-block ans-correct"><div class="ans-title">✅ 正解詳解</div>' +
      '<div class="ans-body">' + esc(it.kind === 'mc' ? (it.correctOpt || '—') : (it.correct || '—')) + '</div></div>';
    if (it.points) {
      h += '<div class="ans-block ans-points"><div class="ans-title">📌 評分備註</div>' +
        '<div class="ans-body">' + esc(it.points) + '</div></div>';
    }
    return h;
  }

  /* ---------------- 記錄頁 ---------------- */
  function renderRecords() {
    var latest = latestMap();
    var totalQ = SUBJECT_ORDER.reduce(function (n, c) { return n + itemsOf(c).length; }, 0);

    // 仍錯清單
    var wrongRows = [];
    SUBJECT_ORDER.forEach(function (code) {
      itemsOf(code).forEach(function (it) {
        var l = latest[it.id];
        if (isWrong(l)) wrongRows.push({ code: code, it: it, l: l });
      });
    });
    wrongRows.sort(function (a, b) {
      // 最近錯過嘅排前，未刷過在後
      var ta = a.l ? a.l.date : 0, tb = b.l ? b.l.date : 0;
      return tb - ta;
    });

    $('#app').innerHTML =
      '<section class="page">' +
        '<header class="page-head"><div><h1 class="page-title">📈 做題記錄</h1>' +
        '<p class="page-sub">每完成一次課題練習就留一個印；滑鼠移上去睇詳情。</p></div>' +
        '<a class="btn btn-ghost" href="#/">← 主頁</a></header>' +

        '<div class="stat-cards">' +
          statCard('🗓️', '累計刷題', sessions.length + ' 次') +
          statCard('📚', '錯題在庫', totalQ + ' 題') +
          statCard('🔁', '上次仍錯', wrongRows.length + ' 題', wrongRows.length ? 'c-red' : 'c-green') +
        '</div>' +

        '<div class="panel"><h2 class="panel-h">刷題活躍圖（近 20 週）</h2><div id="heat"></div>' +
        '<div class="heat-legend">少 <span class="lv lv0"></span><span class="lv lv1"></span>' +
        '<span class="lv lv2"></span><span class="lv lv3"></span><span class="lv lv4"></span> 多</div></div>' +

        '<div class="panel"><div class="panel-h-row"><h2 class="panel-h">🔍 查詢：上次複習仲錯嘅題</h2>' +
          '<div class="filter-seg" id="wrongFilter">' +
            ['ALL', 'chem', 'bio'].map(function (c) {
              var lbl = c === 'ALL' ? '全部' : SUBJECT_META[c].name;
              return '<button class="seg' + (c === 'ALL' ? ' on' : '') + '" data-f="' + c + '" type="button">' + lbl + '</button>';
            }).join('') +
          '</div></div>' +
          '<div class="wrong-list" id="wrongList"></div>' +
        '</div>' +
      '</section>';

    renderHeat();
    renderWrongList('ALL');
    $('#wrongFilter').addEventListener('click', function (e) {
      var b = e.target.closest('.seg'); if (!b) return;
      $all('.seg', this).forEach(function (x) { x.classList.toggle('on', x === b); });
      renderWrongList(b.dataset.f);
    });
  }

  function statCard(ico, label, val, cls) {
    return '<div class="stat-card"><div class="stat-ico">' + ico + '</div>' +
      '<div><div class="stat-val ' + (cls || '') + '">' + val + '</div>' +
      '<div class="stat-lbl">' + label + '</div></div></div>';
  }

  function renderHeat() {
    // 近 140 日，按週列（7 格）
    var days = 140, byDay = {};
    sessions.forEach(function (s) {
      var d = new Date(s.t); d.setHours(0, 0, 0, 0);
      var key = d.getTime();
      if (!byDay[key]) byDay[key] = { n: 0, score: 0, tot: 0 };
      byDay[key].n += 1;
      Object.keys(s.results).forEach(function (id) {
        byDay[key].score += s.results[id].marks;
        byDay[key].tot += s.results[id].tot;
      });
    });
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var start = new Date(today.getTime() - (days - 1) * 864e5);
    start.setDate(start.getDate() - start.getDay()); // 對齊週日

    var html = '<div class="heat-wrap"><div class="heat">';
    var nCol = Math.ceil(((today.getTime() - start.getTime()) / 864e5 + 1) / 7);
    for (var col = 0; col < nCol; col++) {
      html += '<div class="heat-col">';
      for (var dow = 0; dow < 7; dow++) {
        var t = start.getTime() + (col * 7 + dow) * 864e5;
        var future = t > today.getTime();
        var info = byDay[t];
        var lvl = 0;
        if (!future && info) lvl = info.n >= 5 ? 4 : info.n >= 3 ? 3 : info.n >= 2 ? 2 : 1;
        var tip = '';
        if (info) {
          var dt = new Date(t);
          var ds = dt.getFullYear() + '/' + pad(dt.getMonth() + 1) + '/' + pad(dt.getDate());
          tip = ds + ' 刷題 ' + info.n + ' 次（' + info.score + '/' + info.tot + ' 分）';
        }
        html += '<span class="cell lv' + lvl + (future ? ' is-future' : '') + '"' +
          (tip ? ' title="' + tip + '"' : '') + '></span>';
      }
      html += '</div>';
    }
    html += '</div></div>';
    $('#heat').innerHTML = html;
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function renderWrongList(filter) {
    var latest = latestMap();
    var rows = [];
    SUBJECT_ORDER.forEach(function (code) {
      if (filter !== 'ALL' && filter !== code) return;
      itemsOf(code).forEach(function (it) {
        var l = latest[it.id];
        if (isWrong(l)) rows.push({ code: code, it: it, l: l });
      });
    });
    rows.sort(function (a, b) { return (b.l ? b.l.date : 0) - (a.l ? a.l.date : 0); });
    var el = $('#wrongList');
    if (!rows.length) {
      el.innerHTML = '<div class="empty-ok">🎉 呢科嘅錯題全部征服咗！</div>';
      return;
    }
    el.innerHTML = rows.map(function (r) {
      var when = r.l ? fmtDate(r.l.date) : '從未刷過';
      var ratioTxt = r.l && r.l.ratio < 1 ? Math.round(r.l.ratio * 100) + '%' : (r.l ? '✔' : '—');
      return '<a class="wrong-row" href="#/session/' + r.code + '/' + encodeURIComponent(r.it.topic) + '">' +
        '<span class="wrong-subj">' + SUBJECT_META[r.code].icon + '</span>' +
        '<span class="wrong-main"><b>' + esc(r.it.qref) + '</b> ' + esc(r.it.stem) +
          '<small>' + esc(r.it.topic + ' ' + topicName(r.code, r.it.topic)) +
          ' · ' + when + (r.l ? ' · 上次得分率 ' + ratioTxt : '') + '</small></span>' +
        '<span class="wrong-go">再練 →</span></a>';
    }).join('');
  }
  function fmtDate(t) {
    var d = new Date(t);
    return d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate());
  }

  /* ---------------- 重設 ---------------- */
  document.addEventListener('click', function (e) {
    if (e.target.closest('#railReset')) {
      if (confirm('確定清除所有做題記錄同未提交嘅作答？（題庫本身唔會刪）')) {
        localStorage.removeItem(LS_SESS);
        localStorage.removeItem(LS_DRAFT);
        sessions = []; drafts = {};
        location.hash = '#/';
        route();
        toast('已清除');
      }
    }
  });

  route();
})();
