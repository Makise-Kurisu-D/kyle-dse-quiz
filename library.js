/* Private, structured mistake library. No examination data is shipped here. */
(function (global) {
  'use strict';
  var states = [
    { key: 'unseen', label: '未複習' }, { key: 'wrong', label: '仍需複習' },
    { key: 'learning', label: '待鞏固' }, { key: 'mastered', label: '已掌握' },
    { key: 'regressed', label: '回退' }
  ];
  var labels = {}, positions = {}, filters = {}, selectedYears = {}, topicGeneration = 0, activeKey = '', context;
  var memoryUser = '', stopReading = null, readingTimer = null;
  var searchState = { query:'', subject:'', year:'', kind:'', status:'', tag:'', limit:20 };
  states.forEach(function (s) { labels[s.key] = s.label; });
  function esc(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function text(value) { return esc(value).replace(/\n/g, '<br>'); }
  function plainObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
  function blankSearch() { return { query:'', subject:'', year:'', kind:'', status:'', tag:'', limit:20 }; }
  function boundedLimit(value, fallback) { return Number.isInteger(value) && value > 0 ? Math.min(value, 1000) : fallback; }
  function storageKey(user) { return 'dse_library_view_v1:' + user; }
  function saveReading() {
    if (!memoryUser) return;
    try { global.localStorage.setItem(storageKey(memoryUser), JSON.stringify({version:1, positions:positions, filters:filters, years:selectedYears, search:searchState})); } catch (_) {}
  }
  function chooseUser(user) {
    user = typeof user === 'string' && /^[a-z0-9_-]{1,40}$/i.test(user) ? user : '';
    if (memoryUser === user) return;
    clearReading(); positions = {}; filters = {}; selectedYears = {}; searchState = blankSearch(); memoryUser = user;
    if (!user) return;
    try {
      var saved = JSON.parse(global.localStorage.getItem(storageKey(user)) || 'null');
      if (!saved || saved.version !== 1) return;
      if (plainObject(saved.positions)) Object.keys(saved.positions).slice(-200).forEach(function (key) {
        var row = saved.positions[key];
        if (!plainObject(row) || !Number.isFinite(row.scroll) || row.scroll < 0) return;
        positions[key] = {scroll:Math.min(row.scroll, 1e7), open:plainObject(row.open) ? row.open : {},
          anchor:row.anchor && typeof row.anchor.id === 'string' && Number.isFinite(row.anchor.offset) ? row.anchor : null};
      });
      if (plainObject(saved.filters)) Object.keys(saved.filters).slice(-200).forEach(function (key) {
        var source = saved.filters[key]; if (!plainObject(source)) return;
        var clean = {}; ['query','status','kind','year','sort'].forEach(function (name) { if (typeof source[name] === 'string') clean[name] = source[name].slice(0,200); });
        clean.limit = boundedLimit(source.limit, 12); filters[key] = clean;
      });
      if (plainObject(saved.years)) Object.keys(saved.years).slice(-20).forEach(function (code) { if (/^(all|20\d{2})$/.test(saved.years[code])) selectedYears[code] = saved.years[code]; });
      if (plainObject(saved.search)) {
        Object.keys(searchState).forEach(function (name) { if (name !== 'limit' && typeof saved.search[name] === 'string') searchState[name] = saved.search[name].slice(0,200); });
        searchState.limit = boundedLimit(saved.search.limit,20);
      }
    } catch (_) {}
  }
  function safeBack(value) {
    return typeof value === 'string' && value.length <= 24000 && /^#\/(?:$|(?:practice|session|today|drill|random|library|records)(?:[/?]|$))/.test(value) &&
      !/[\u0000-\u001f<>]/.test(value) && !/[?&](?:handoff|sync)=/.test(value) ? value : '';
  }
  function currentBack() { return safeBack(global.location && global.location.hash) || '#/library/books'; }
  function questionBack() {
    var hash = global.location && global.location.hash || '', found = '';
    String(hash).split('?').slice(1).join('?').split('&').forEach(function (pair) {
      var index = pair.indexOf('='); if (index < 0) return;
      try { if (decodeURIComponent(pair.slice(0,index)) === 'back') found = decodeURIComponent(pair.slice(index+1).replace(/\+/g,' ')); } catch (_) {}
    });
    return safeBack(found);
  }
  function selectionIds(ids) {
    return Array.from(new Set((ids || []).filter(function (id) { return typeof id === 'string' && id.length > 0 && id.length <= 200 && id.indexOf(',') < 0; }))).slice(0,100);
  }
  function drillHref(code, ids, back) {
    var selected = selectionIds(ids);
    if (!selected.length) return '';
    back = safeBack(back) || currentBack();
    return '#/drill/' + encodeURIComponent(code) + '?ids=' + encodeURIComponent(selected.join(',')) + '&back=' + encodeURIComponent(back);
  }
  function selectionLink(node, code, ids) {
    var selected = selectionIds(ids); node.hidden = !selected.length;
    node.href = drillHref(code, selected);
    node.textContent = ids.length > selected.length ? '練習篩選前 ' + selected.length + ' 題（共 ' + ids.length + ' 題）' : '練習篩出的 ' + selected.length + ' 題';
  }
  function submittedAnswers(item, history) {
    return independentHistory(history).filter(function (session) { return session.results[item.id]; }).slice(-2).reverse().map(function (session) {
      var result = session.results[item.id], attempt = result.attempt;
      var valid = attempt && attempt.version === 1 && attempt.questionId === item.id && attempt.submittedAt === session.t;
      return { t:session.t, marks:result.marks, total:result.tot, correct:full(result),
        answer:valid && !attempt.onPaper && typeof attempt.answer === 'string' ? attempt.answer : null,
        onPaper:!!(valid && attempt.onPaper), assisted:!!(valid && attempt.assisted),
        checked:valid && Array.isArray(attempt.checkedIndices) ? attempt.checkedIndices.slice() : [],
        scoreMethod:valid ? attempt.scoreMethod : null };
    });
  }
  function comparisonHtml(item) {
    var rows = submittedAnswers(item, context.history);
    return '<section class="ml-comparison" aria-label="歷次提交原答對照"><h3>原卷與重做對照</h3><p class="review-note">原卷答案見上方；以下只顯示已提交的原文，與原卷判分分開保存。</p>' +
      (rows.length ? '<div class="ml-comparison-grid">' + rows.map(function (row, index) {
        return '<article><h4>' + (index ? '上一次提交' : '最近提交') + '</h4><p class="ml-comparison-meta">' + esc(context.formatDate(row.t)) +
          (Number.isFinite(row.marks) && Number.isFinite(row.total) ? ' · ' + row.marks + '/' + row.total : '') + (row.assisted ? ' · 曾使用輔助' : '') + '</p>' +
          '<div class="ml-submitted-answer">' + (row.onPaper ? '紙上作答：未保存原答影像，無法顯示或比對原文。' : row.answer !== null && row.answer.trim() ? text(row.answer) : '這筆歷史記錄未保存提交原文，不補造答案。') + '</div>' +
          (row.checked.length ? '<p class="review-note">當時勾選的核對項：' + esc(row.checked.map(function (n) { return n + 1; }).join('、')) + '。以該次題目版本為準。</p>' : '') + '</article>';
      }).join('') + '</div>' : '<p class="review-note">尚無已提交的重做記錄。</p>') + '</section>';
  }
  function noteKey(id) { return 'dse_library_note_v1:' + memoryUser + ':' + encodeURIComponent(id); }
  function personalNote(item) {
    var value = '', available = !!memoryUser;
    try { if (available) value = String(global.localStorage.getItem(noteKey(item.id)) || '').slice(0,1000); } catch (_) { available = false; }
    var id = 'ml-note-' + fingerprint(item.id);
    return '<details class="ml-note" data-reading-id="note-' + esc(item.id) + '"><summary>我的防錯提醒（選填）</summary><label for="' + id + '">寫一句下次要提醒自己的話</label>' +
      '<textarea id="' + id + '" data-note-id="' + esc(item.id) + '" maxlength="1000" rows="3" placeholder="例如：讀完題目後再核對單位。"' + (available ? '' : ' disabled') + '>' + esc(value) + '</textarea>' +
      '<p class="review-note">僅本機保存，不會當作已提交原答、得分或掌握證據。</p><p class="review-note" data-note-status role="status" aria-live="polite">' +
      (available ? value ? '已保存在此裝置。' : '' : '此裝置暫時無法保存提醒。') + '</p></details>';
  }
  function conceptCards(items) {
    var cards = [], known = new Map();
    (items || []).forEach(function (item) {
      var excerpts = [];
      if (typeof item.correct === 'string' && item.correct.trim()) excerpts.push({label:'正解原文',value:item.correct});
      if (typeof item.points === 'string' && item.points.trim()) excerpts.push({label:'得分說明原文',value:item.points});
      var checks = (item.checks || []).filter(function (point) { return typeof point === 'string' && point.trim() && !/^\s*[✗×]/.test(point); });
      if (checks.length) excerpts.push({label:'核對要點原文',value:checks.join('\n')});
      if (!excerpts.length) return;
      var key = excerpts.map(function (excerpt) { return excerpt.value.replace(/\s+/g,' ').trim(); }).join('\n');
      if (known.has(key)) { known.get(key).sources.push(item); return; }
      var row = {id:'concept-' + fingerprint(key),prompt:item.stemFull || item.stem || item.qref,excerpts:excerpts,sources:[item]};
      known.set(key,row); cards.push(row);
    });
    return cards;
  }
  // Publication year remains the storage key; mock set numbers are display metadata.
  function sourceInfo(year, detail, items) {
    detail = detail || {};
    var candidates = [detail.title, detail.paper, detail.paper_id, detail.assessment && detail.assessment.scope];
    (candidates.some(Boolean) ? [] : items || []).filter(function (item) { return String(item.year) === String(year); }).forEach(function (item) { candidates.push(item.paper, item.paper_id); });
    var match = candidates.map(function (value) { return String(value || '').match(/\bmock(?:[\s_-]*(?:test|set))?[\s_·#-]*(\d+)\b/i); }).filter(Boolean)[0];
    var number = match ? Number(match[1]) : null;
    return { year: String(year), mock: number !== null, number: number, label: number !== null ? 'MOCK TEST ' + number : String(year), badge: number !== null ? String(number) : String(year).slice(-2) };
  }
  function compareSources(a, b) {
    return Number(a.mock) - Number(b.mock) || (a.mock ? a.number - b.number : b.year.localeCompare(a.year));
  }
  function sourceYears(items, papers) {
    return Array.from(new Set(items.map(function (item) { return String(item.year); }))).sort(function (a, b) {
      return compareSources(sourceInfo(a, papers && papers[a], items), sourceInfo(b, papers && papers[b], items));
    });
  }
  function itemSource(item) {
    var info = sourceInfo(item.year, item);
    return info.mock ? info.label + ' · ' + String(item.paper || '').replace(/\bmock(?:[\s_-]*(?:test|set))?[\s_·#-]*\d+\b[\s·-]*/i, '') : item.year + ' · ' + item.paper;
  }
  function full(result) {
    return !!result && result.ok === true && (!result.tot ||
      (Number.isFinite(result.marks) && result.marks >= result.tot));
  }
  // A checklist describes evidence; only a reviewed rubric can assign marks.
  function practiceMaximum(item) {
    var count = (item && item.checks || []).length;
    var marks = item && item.marks;
    if (!Number.isFinite(marks)) {
      var matched = String(item && item.qref || '').match(/（\s*([0-9]+(?:\.[0-9]+)?)\s*分/);
      marks = matched ? Number(matched[1]) : count || 1;
    }
    return marks;
  }
  function practiceRubric(item) {
    var rubric = item && item.practiceRubric, count = (item && item.checks || []).length;
    var marks = practiceMaximum(item);
    if (!rubric || rubric.version !== 1 || !Array.isArray(rubric.groups) || !rubric.groups.length) return null;
    function validCondition(condition) {
      if (Number.isInteger(condition)) return condition >= 0 && condition < count && !/^✗/.test(item.checks[condition]);
      if (!condition || typeof condition !== 'object') return false;
      var keys = Object.keys(condition);
      return keys.length === 1 && ['all', 'any'].indexOf(keys[0]) >= 0 &&
        Array.isArray(condition[keys[0]]) && condition[keys[0]].length > 0 && condition[keys[0]].every(validCondition);
    }
    var ids = new Set(), total = 0;
    var valid = rubric.groups.every(function (group) {
      if (!group || typeof group.id !== 'string' || !group.id || ids.has(group.id) ||
          !Number.isFinite(group.marks) || group.marks <= 0) return false;
      ids.add(group.id); total += group.marks;
      var conditionKeys = ['condition', 'all', 'any'].filter(function (name) { return Object.prototype.hasOwnProperty.call(group, name); });
      if (conditionKeys.length !== 1) return false;
      var condition = conditionKeys[0] === 'condition' ? group.condition : conditionKeys[0] === 'all' ? { all: group.all } : { any: group.any };
      return validCondition(condition);
    });
    return valid && Math.abs(total - marks) < 1e-9 ? rubric : null;
  }
  function practiceScore(item, checkedIndices, manualScore) {
    var rubric = practiceRubric(item), checked = new Set(checkedIndices || []);
    function reached(condition) {
      if (Number.isInteger(condition)) return checked.has(condition);
      return condition.all ? condition.all.every(reached) : condition.any.some(reached);
    }
    if (!rubric) return Number.isFinite(manualScore) && manualScore >= 0 && manualScore <= practiceMaximum(item) ? manualScore : null;
    return rubric.groups.reduce(function (sum, group) {
      var condition = Object.prototype.hasOwnProperty.call(group, 'condition') ? group.condition : group.all ? { all: group.all } : { any: group.any };
      return sum + (reached(condition) ? group.marks : 0);
    }, 0);
  }
  function fingerprint(value) {
    var text = JSON.stringify(value), hash = 2166136261;
    for (var i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    // Version identity only; this is not a security or acceptance hash.
    return 'fnv1a-' + (hash >>> 0).toString(16).padStart(8, '0');
  }
  function attemptSnapshot(item, answer, checkedIndices, result, at, options) {
    options = options || {};
    var rubric = practiceRubric(item);
    return JSON.parse(JSON.stringify({ version: 1, submittedAt: at, questionId: item.id,
      kind: item.kind, answer: String(answer == null ? '' : answer),
      checkedIndices: (checkedIndices || []).slice().sort(function (a, b) { return a - b; }),
      questionVersion: fingerprint([item.id, item.stemFull || item.stem || '', item.options || [],
        item.figures || [], item.tables || [], item.paper_id || '', item.source_sha256 || null,
        item.checks || [], item.correct || item.correctOpt || '', item.marks]),
      sourceSha256: item.source_sha256 || null,
      rubricVersion: rubric ? fingerprint(rubric) : 'manual-v1',
      scoreMethod: item.kind === 'mc' ? 'mc-comparison' : rubric ? 'reviewed-rubric' : 'manual',
      marks: result.marks, total: result.tot, assisted: options.assisted === true,
      onPaper: options.onPaper === true, nextReviewAt: options.nextReviewAt || null }));
  }
  function independentAttempt(result, at) {
    var attempt = result && result.attempt;
    return !!attempt && attempt.version === 1 && attempt.submittedAt === at &&
      typeof attempt.questionVersion === 'string' && typeof attempt.rubricVersion === 'string' &&
      typeof attempt.answer === 'string' && attempt.answer.trim().length > 0 && !attempt.onPaper && !attempt.assisted && !result.assisted &&
      attempt.marks === result.marks && attempt.total === result.tot;
  }
  function independentHistory(history) {
    var grouped = new Map();
    (history || []).forEach(function (session) {
      if (!session || !Number.isFinite(session.t) || session.t > Date.now() || !session.results) return;
      var key = JSON.stringify([session.t, session.subj, session.topic]);
      var row = grouped.get(key);
      if (!row) { row = { t: session.t, subj: session.subj, topic: session.topic, results: {} }; grouped.set(key, row); }
      Object.keys(session.results).forEach(function (id) {
        var next = session.results[id];
        if (!next || typeof next.ok !== 'boolean') return;
        // Replayed/merged copies of one submitted exercise count only once.
        if (!row.results[id] || !full(next) || (full(row.results[id]) && !independentAttempt(next, session.t))) row.results[id] = next;
      });
    });
    return Array.from(grouped.values()).sort(function (a, b) { return a.t - b.t; });
  }
  function indexHistory(history) {
    var index = Object.create(null);
    independentHistory(history).forEach(function (session) {
      Object.keys(session.results).forEach(function (id) {
        var result = session.results[id], correct = full(result), independent = independentAttempt(result, session.t);
        var row = index[id] || { streak: 0, everCorrect: false, attempts: 0, history: [] };
        if (correct && !row.everCorrect) row.firstCorrectAt = session.t;
        if (!correct) {
          row.state = row.everCorrect ? 'regressed' : 'wrong'; row.streak = 0;
          row.qualifyingAt = null; row.nextReviewAt = null;
        } else if (independent) {
          var version = result.attempt.questionVersion + '/' + result.attempt.rubricVersion;
          if (row.qualifyingVersion && row.qualifyingVersion !== version) { row.qualifyingAt = null; row.streak = 0; row.state = 'learning'; }
          var due = row.qualifyingAt == null ? Infinity : Math.max(row.qualifyingAt + 864e5, row.nextReviewAt || 0);
          if (session.t >= due) { row.streak++; row.state = 'mastered'; }
          else row.state = row.state === 'mastered' ? 'mastered' : 'learning';
          // An early repeated success must not move the consolidation goalpost.
          if (row.qualifyingAt == null || session.t >= due) {
            row.qualifyingAt = session.t; row.nextReviewAt = result.attempt.nextReviewAt; row.qualifyingVersion = version;
            row.streak = Math.max(1, row.streak);
          }
        } else {
          row.state = row.state === 'mastered' ? 'mastered' : 'learning';
        }
        row.everCorrect = row.everCorrect || correct;
        row.attempts++; row.lastAt = session.t;
        row.history.push({ t: session.t, correct: correct, independent: independent, marks: result.marks, tot: result.tot });
        if (row.history.length > 5) row.history.shift();
        index[id] = row;
      });
    });
    return index;
  }
  function summarize(items, history) {
    var out = { total: items.length, lost: 0, lostKnown: 0, newSolved: 0, regressions: 0 };
    states.forEach(function (s) { out[s.key] = 0; });
    items.forEach(function (item) {
      var row = history[item.id]; out[row ? row.state : 'unseen']++;
      if (Number.isFinite(item.lost) && item.lost >= 0) { out.lost += item.lost; out.lostKnown++; }
    });
    return out;
  }
  function dailyCandidates(data, history, plans, code, now) {
    var index = indexHistory(history), seen = new Set(), rows = [];
    var dayEnd = Math.floor((now + 8 * 3600e3) / 864e5) * 864e5 + 864e5 - 8 * 3600e3;
    Object.keys(data.subjects).forEach(function (subject) {
      if (code !== 'all' && code !== subject) return;
      data.subjects[subject].items.forEach(function (item) {
        if (seen.has(item.id)) return;
        seen.add(item.id);
        var row = index[item.id], plan = plans[item.id], failures = 0;
        if (row) for (var i = row.history.length - 1; i >= 0 && !row.history[i].correct; i--) failures++;
        var due = !!(plan && Number.isFinite(plan.dueAt) && plan.dueAt < dayEnd);
        var regressed = !!row && row.state === 'regressed';
        var priority = due ? 0 : regressed ? 1 : failures >= 2 ? 2 : !row || row.state === 'wrong' ? 3 : row.state === 'learning' ? 4 : 5;
        rows.push({ item: item, code: subject, due: due, priority: priority, failures: failures,
          lastAt: row ? row.lastAt : 0,
          reason: due ? '複習到期' : regressed ? '答對後回退' : failures >= 2 ? '連續答錯' : !row ? '尚未複習' : row.state === 'wrong' ? '仍需鞏固' : '間隔鞏固' });
      });
    });
    return rows.sort(function (a, b) {
      return a.priority - b.priority || b.failures - a.failures ||
        (Number.isFinite(b.item.lost) ? b.item.lost : 0) - (Number.isFinite(a.item.lost) ? a.item.lost : 0) || a.lastAt - b.lastAt || a.item.id.localeCompare(b.item.id);
    });
  }
  function badge(state) { return '<span class="ml-badge ml-' + state + '">' + labels[state] + '</span>'; }
  function bar(stats) {
    return '<div class="ml-progress" role="img" aria-label="' +
      states.map(function (s) { return s.label + ' ' + stats[s.key] + ' 題'; }).join('，') + '">' +
      states.map(function (s) { return stats[s.key] ? '<span class="ml-' + s.key + '" style="width:' +
        (stats.total ? stats[s.key] / stats.total * 100 : 0) + '%"></span>' : ''; }).join('') + '</div>';
  }
  function legend(stats) {
    return '<div class="ml-legend">' + states.map(function (s) {
      return '<span><i class="ml-dot ml-' + s.key + '"></i>' + s.label + ' <b>' + stats[s.key] + '</b></span>';
    }).join('') + '</div>';
  }
  function subjectName(code) { return global.DSESubjects.names[code] || code; }
  function icon(code) { return global.DSESubjects.icon(code); }
  function header(title, sub, back, label) {
    return '<header class="page-head"><div><h1 class="page-title">' + title + '</h1><p class="page-sub">' + sub +
      '</p></div><a class="btn btn-ghost" href="' + esc(back) + '">← ' + label + '</a></header>';
  }
  function readingNodes() { return context && context.root.querySelectorAll ? Array.prototype.slice.call(context.root.querySelectorAll('[data-reading-id]')) : []; }
  function captureReading() {
    if (!activeKey || !context) return;
    var pane = context.scrollRoot, nodes = readingNodes(), previous = positions[activeKey];
    var row = {scroll:pane ? pane.scrollTop : global.scrollY || 0, open:previous && previous.open || {}, anchor:null};
    var top = pane && pane.getBoundingClientRect ? pane.getBoundingClientRect().top : 0, anchor;
    nodes.forEach(function (node) {
      var id = node.getAttribute('data-reading-id'); row.open[id] = node.open === true;
      if (!node.getBoundingClientRect) return;
      var box = node.getBoundingClientRect();
      if (box.height && box.top <= top + 24 && box.bottom > top + 24) anchor = {id:id, offset:box.top - top};
      else if (!anchor && box.height && box.top > top) anchor = {id:id, offset:box.top - top};
    });
    row.anchor = anchor || null; positions[activeKey] = row; saveReading();
  }
  function clearReading() {
    if (readingTimer !== null && global.clearTimeout) global.clearTimeout(readingTimer);
    readingTimer = null;
    if (stopReading) stopReading();
    stopReading = null;
  }
  function restoreReading(key) {
    if (activeKey !== key || !context) return;
    var row = positions[key], nodes = readingNodes(), api = context;
    if (!row) return;
    nodes.forEach(function (node) { var id = node.getAttribute('data-reading-id'); if (Object.prototype.hasOwnProperty.call(row.open || {},id)) node.open = row.open[id] === true; });
    var pane = api.scrollRoot;
    if (pane) pane.scrollTop = row.scroll;
    else if (global.scrollTo) global.scrollTo(0,row.scroll);
    var anchor = row.anchor && nodes.filter(function (node) { return node.getAttribute('data-reading-id') === row.anchor.id; })[0];
    if (anchor && anchor.getBoundingClientRect && pane && pane.getBoundingClientRect) pane.scrollTop += anchor.getBoundingClientRect().top - pane.getBoundingClientRect().top - row.anchor.offset;
    nodes.forEach(function (node) { if (node.open && api.hydrate) api.hydrate(node); });
  }
  function bindReading(key) {
    clearReading();
    var api = context, root = api.root, pane = api.scrollRoot || global;
    function current() { return context === api && activeKey === key; }
    function capture() {
      if (!current()) return;
      if (readingTimer !== null && global.clearTimeout) global.clearTimeout(readingTimer);
      if (global.setTimeout) readingTimer = global.setTimeout(function () { readingTimer = null; if (current()) captureReading(); },150);
      else captureReading();
    }
    function toggle(event) {
      if (!current()) return;
      var detail = event.target;
      if (detail && detail.open && detail.hasAttribute && detail.hasAttribute('data-reading-id') && api.hydrate) {
        Array.prototype.forEach.call(detail.querySelectorAll('[data-library-image]'),function (img) { img.setAttribute('data-bank-image',img.getAttribute('data-library-image')); img.removeAttribute('data-library-image'); });
        api.hydrate(detail);
      }
      capture();
    }
    function leave() { if (current()) captureReading(); }
    function noteInput(event) {
      if (!current() || !memoryUser) return;
      var node = event.target, id = node && node.getAttribute && node.getAttribute('data-note-id');
      if (!id || id.length > 200) return;
      var message;
      try { global.localStorage.setItem(noteKey(id),String(node.value || '').slice(0,1000)); message = '已保存在此裝置。'; }
      catch (_) { message = '此裝置未能保存，請先複製提醒文字。'; }
      var section = node.closest && node.closest('.ml-note'), status = section && section.querySelector('[data-note-status]');
      if (status) status.textContent = message;
    }
    if (root.addEventListener) root.addEventListener('toggle',toggle,true);
    if (root.addEventListener) root.addEventListener('input',noteInput);
    if (pane.addEventListener) pane.addEventListener('scroll',capture,{passive:true});
    if (global.addEventListener) global.addEventListener('pagehide',leave);
    stopReading = function () {
      if (root.removeEventListener) root.removeEventListener('toggle',toggle,true);
      if (root.removeEventListener) root.removeEventListener('input',noteInput);
      if (pane.removeEventListener) pane.removeEventListener('scroll',capture);
      if (global.removeEventListener) global.removeEventListener('pagehide',leave);
    };
  }
  function remember() { captureReading(); clearReading(); activeKey = ''; }
  function frame(key, html) {
    clearReading(); activeKey = key;
    var api = context;
    context.root.innerHTML = '<section class="page ml-page' + (key === 'subjects' ? ' ml-subject-picker' : '') + '">' + html + '</section>';
    bindReading(key);
    if (positions[key]) (global.requestAnimationFrame || function (fn) { fn(); })(function () { if (context === api) restoreReading(key); });
  }
  function overview() {
    var subjects = context.data.subjects;
    frame('subjects', header('<span class="persona-icon persona-icon-library" aria-hidden="true"></span> 錯題庫', '從科目到課題，直接找到需要重溫的錯題。', '#/', '主頁') +
      '<div class="ml-reading-actions"><a class="btn btn-primary ml-global-entry" href="#/library/books/search">搜尋全科錯題 · 題號、知識點、答案與解析</a>' +
      '<a class="btn btn-ghost" href="#/library/books/concepts">概念回顧 · 先回憶再核對</a></div>' +
      '<div class="ml-subject-dock"><div class="ml-subjects">' + global.DSESubjects.libraryOrder(subjects).map(function (code) {
        var stats = summarize(subjects[code].items, context.index);
        var percent = stats.total ? Math.round(stats.mastered / stats.total * 100) : 0;
        return '<a class="ml-subject ml-subject-' + code + '" href="#/library/books/' + code + '">' +
          '<div class="ml-card-top"><span class="ml-subject-icon">' + icon(code) + '</span><span class="ml-eyebrow">DSE · 按課題複習</span></div>' +
          '<h2>' + subjectName(code) + '</h2><p>' + subjects[code].topics.length + ' 個收錄課題 · ' + stats.total + ' 張錯題卡</p>' +
          '<span class="ml-picker-count">' + stats.total + ' 張錯題卡</span>' +
          '<div class="ml-subject-metrics"><span><b>' + (stats.total - stats.mastered) + '</b>待複習／鞏固</span>' +
          '<span><b>' + percent + '%</b>已掌握</span></div>' + bar(stats) + legend(stats) +
          '<span class="ml-open">查看課題與錯因 <span aria-hidden="true">→</span></span></a>';
      }).join('') + '</div>' +
      '<p class="library-note">已掌握＝保存原答後，兩次獨立練習連續全對，並在間隔複習到期後再次答對（至少相隔一天）。舊記錄保留；缺少原答或使用輔助的記錄不新增掌握證據，之後未全對會標為回退。</p></div>');
  }
  function summary(code, items, title) {
    var stats = summarize(items, context.index), fresh = 0, regressions = 0;
    items.forEach(function (item) {
      var row = context.index[item.id];
      if (!row) return;
      if (row.firstCorrectAt >= context.cycleStart && row.history[row.history.length - 1].correct) fresh++;
      if (row.state === 'regressed' && row.lastAt >= context.cycleStart) regressions++;
    });
    var lostText = stats.lostKnown === stats.total && stats.total ? stats.lost + ' 分原卷失分' : '原卷失分以已核實資料為準';
    return '<div class="ml-summary ml-summary-' + code + '"><div class="ml-summary-heading"><div><span class="ml-eyebrow">學習總覽</span>' +
      '<h2>' + esc(title) + '</h2><p>' + lostText + ' · 掌握進度以歷次已提交練習計算</p></div><span class="ml-summary-percent">' +
      (stats.total ? Math.round(stats.mastered / stats.total * 100) : 0) + '<small>% 已掌握</small></span></div>' +
      '<div class="ml-summary-metrics"><span><b>' + stats.total + '</b>收錄錯題卡</span><span><b>' + (stats.total - stats.mastered) +
      '</b>待複習／鞏固</span><span><b>' + fresh + '</b>本雙周新解決</span><span><b>' + regressions + '</b>本雙周回退</span></div>' +
      bar(stats) + legend(stats) + '</div>';
  }
  function topicPage(code) {
    var api = context, generation = ++topicGeneration, subject = api.data.subjects[code];
    var years = sourceYears(subject.items);
    var selected = selectedYears[code] || 'all', catalog = null;
    if (selected !== 'all' && years.indexOf(selected) < 0) selected = 'all';
    var order = global.DSESubjects.libraryOrder(api.data.subjects);
    var subjectIndex = order.indexOf(code);
    var previous = order[(subjectIndex + order.length - 1) % order.length];
    var next = order[(subjectIndex + 1) % order.length];
    frame(code, header('錯題庫與歸納', '選年份，再選課題。原答案、錯因與正解依次展開。', '#/library/books', '科目') +
      '<div class="ml-reading-actions"><a class="btn btn-ghost" href="#/library/books/concepts/' + code + '">回顧' + subjectName(code) + '概念</a></div>' +
      '<div class="inventory-switch" aria-label="學科切換"><a class="shoulder-link" href="#/library/books/' + previous + '" aria-label="上一個學科：' + subjectName(previous) + '">‹ LB</a>' +
      '<strong>' + subjectName(code) + '</strong><a class="shoulder-link" href="#/library/books/' + next + '" aria-label="下一個學科：' + subjectName(next) + '">RB ›</a></div>' +
      '<div class="inventory-layout"><section class="inventory-years" aria-label="年份與原卷成績"><h2>YEAR SELECT / 年份與狀態</h2>' +
      '<div class="year-list" id="mlYears"></div><p class="year-grade-note">LV＝DSE 試卷參考等級（非官方估算）；HP＝原卷分數；SP＝錯題數。缺少適用分界時顯示「—」；單卷不評全科等級。</p>' +
      '<p class="year-grade-note" id="mlGradeStatus" role="status">正在核對原卷成績…</p><div id="mlYearSummary"></div></section>' +
      '<section class="inventory-topics" aria-label="課題目錄"><div class="ml-section-head"><h2>TOPIC LIST / 課題</h2><label>排序 <select id="mlTopicSort"><option value="syllabus">考綱順序</option>' +
      '<option value="pending">待複習最多</option></select></label></div><div class="ml-topics" id="mlTopics"></div>' +
      '<section class="topic-info" aria-label="課題資訊"><span aria-hidden="true">INFO</span><div id="mlTopicInfo" aria-live="polite"></div></section></section></div>' +
      '<p class="library-note">長期已掌握＝有原答記錄的兩次獨立練習連續全對，且在間隔複習到期後再次答對；閱讀不計作答。</p>');
    var root = api.root, sort = root.querySelector('#mlTopicSort');
    sort.value = (filters[code] || {}).sort || 'syllabus';
    function currentItems() { return subject.items.filter(function (item) { return selected === 'all' || String(item.year) === selected; }); }
    function drawYears() {
      years = sourceYears(subject.items, catalog && catalog.papers && catalog.papers[code]);
      root.querySelector('#mlYears').innerHTML = ['all'].concat(years).map(function (year) {
        var items = subject.items.filter(function (item) { return year === 'all' || String(item.year) === year; });
        var detail = catalog && catalog.papers && catalog.papers[code] && catalog.papers[code][year];
        var info = sourceInfo(year, detail, items);
        var assessment = detail && detail.assessment;
        var metrics = api.gradeMetrics && api.gradeMetrics(assessment);
        var level = metrics && metrics.current ? metrics.current.level : '—';
        var score = metrics ? assessment.earned + '/' + assessment.total : '—';
        return '<button class="inventory-year" type="button" data-year="' + esc(year) + '" aria-pressed="' + (selected === year) + '">' +
          '<span class="year-number" aria-hidden="true">' + (year === 'all' ? 'ALL' : esc(info.badge)) + '</span><span class="year-body"><span class="year-name">' +
          (year === 'all' ? '全部年份' : esc(info.label + ' ' + subjectName(code))) + '</span><span class="year-meters">' +
          (year === 'all' ? '' : '<span><abbr title="DSE 試卷等級">LV</abbr> <b>' + esc(level) + '</b></span><span><abbr title="原卷分數">HP</abbr> <b>' + score + '</b></span>') +
          '<span><abbr title="錯題數">SP</abbr> <b>' + items.length + '</b></span></span>' +
          (year !== 'all' && metrics ? '<span class="year-grade-note">' + esc(info.mock ? info.label + ' · ' + subjectName(code) : assessment.scope) + (metrics.current ? ' · 等級估算' : ' · 等級未評') + '</span>' : '') + '</span></button>';
      }).join('');
    }
    function inspect(row) {
      root.querySelector('#mlTopicInfo').innerHTML = '<h3>' + esc(row.topic.code + ' ' + row.topic.name) + '</h3><p>' +
        (selected === 'all' ? '全部年份' : esc(sourceInfo(selected, null, subject.items).label + (sourceInfo(selected, null, subject.items).mock ? '' : ' 年'))) + ' · ' + row.stats.total + ' 張錯題卡 · ' +
        (row.stats.total - row.stats.mastered) + ' 題待複習／鞏固 · ' + row.stats.mastered + ' 題長期已掌握。</p>' +
        '<a href="#/library/books/' + code + '/' + encodeURIComponent(row.topic.code) + '">展開本課題歸納 ↗</a>';
      Array.prototype.forEach.call(root.querySelectorAll('.ml-topic'), function (link) { link.classList.toggle('inspected', link.getAttribute('data-topic') === row.topic.code); });
    }
    function draw() {
      var items = currentItems();
      var rows = subject.topics.map(function (topic) {
        return { topic: topic, stats: summarize(items.filter(function (item) { return item.topic === topic.code; }), api.index) };
      }).filter(function (row) { return row.stats.total > 0; });
      if (sort.value === 'pending') rows.sort(function (a, b) { return (b.stats.total - b.stats.mastered) - (a.stats.total - a.stats.mastered); });
      root.querySelector('#mlYearSummary').innerHTML = summary(code, items, selected === 'all' ? '全部年份學習總覽' : sourceInfo(selected, null, subject.items).label + ' 學習總覽');
      root.querySelector('#mlTopics').innerHTML = rows.map(function (row) {
        var st = row.stats;
        return '<a class="ml-topic" data-topic="' + esc(row.topic.code) + '" href="#/library/books/' + code + '/' + encodeURIComponent(row.topic.code) + '">' +
          '<div class="ml-topic-title"><span class="ml-topic-code">' + esc(row.topic.code) + '</span><div><h3>' + esc(row.topic.name) +
          '</h3><p>' + st.total + ' 張錯題卡 · ' + (st.total - st.mastered) + ' 題待複習／鞏固' +
          (st.lostKnown === st.total ? ' · 原卷失分 ' + st.lost + ' 分' : '') + '</p></div><span class="ml-topic-arrow" aria-hidden="true">↗</span></div>' + bar(st) + legend(st) + '</a>';
      }).join('') || '<p class="review-note">此年份尚未收錄錯題。</p>';
      Array.prototype.forEach.call(root.querySelectorAll('.ml-topic'), function (link) {
        var row = rows.filter(function (r) { return r.topic.code === link.getAttribute('data-topic'); })[0];
        link.addEventListener('mouseenter', function () { inspect(row); });
        link.addEventListener('focus', function () { inspect(row); });
      });
      if (rows.length) inspect(rows[0]); else root.querySelector('#mlTopicInfo').textContent = '尚未有可查看的課題。';
    }
    root.querySelector('#mlYears').addEventListener('click', function (event) {
      var button = event.target.closest('[data-year]');
      if (!button) return;
      selected = button.getAttribute('data-year'); selectedYears[code] = selected;
      subject.topics.forEach(function (topic) {
        var remembered = filters[code + '/' + topic.code];
        if (remembered) remembered.year = selected === 'all' ? '' : selected;
      });
      // Keep the pressed year button mounted so keyboard focus is preserved.
      Array.prototype.forEach.call(root.querySelectorAll('[data-year]'), function (node) { node.setAttribute('aria-pressed', String(node === button)); });
      draw(); saveReading();
    });
    sort.addEventListener('change', function () { filters[code] = { sort: sort.value }; draw(); saveReading(); });
    drawYears(); draw();
    if (api.catalog) api.catalog().then(function (result) {
      if (activeKey !== code || context !== api || generation !== topicGeneration) return;
      catalog = result;
      var focused = document.activeElement, year = focused && focused.getAttribute && focused.getAttribute('data-year');
      drawYears();
      if (year) { var replacement = root.querySelector('[data-year="' + year + '"]'); if (replacement && replacement.focus) replacement.focus(); }
      root.querySelector('#mlGradeStatus').textContent = result ? '已核對私人批改卷的成績與 DSE 參考分界。未有適用分界的原卷顯示「—」。' : '登入後可核對原卷分數；題目數與學習狀態仍可查看。';
    }).catch(function () {
      if (activeKey === code && context === api && generation === topicGeneration) root.querySelector('#mlGradeStatus').textContent = '原卷成績暫未能讀取。可先查看錯題；重新進入此頁可重試。';
    });
  }
  function card(item, year, returnBack) {
    var row = context.index[item.id], state = row ? row.state : 'unseen';
    var own = item.kind === 'mc' ? text(item.option || '未作答') : (item.my || []).map(function (segment) {
      return '<span' + (segment[1] ? ' class="ml-answer-error"' : '') + '>' + text(segment[0]) + '</span>';
    }).join('<br>') || '未作答';
    var figures = Array.isArray(item.figures) ? item.figures : [];
    return '<details class="ml-question" id="question-' + esc(item.id) + '" data-reading-id="question-' + esc(item.id) + '"><summary><span class="ml-question-meta">' +
      esc(itemSource(item) + ' · ' + item.qref) + (Number.isFinite(item.lost) ? ' · 原卷失分 ' + item.lost : '') + '</span>' + badge(state) +
      '<span class="ml-question-title">' + esc(item.stem) + '</span><span class="ml-question-expand">查看完整題目 · 答案另行展開</span></summary>' +
      '<div class="ml-question-body"><div class="ml-stem"><h3>' + (item.stemFull ? '題目' : '題目要點') + '</h3><p>' + text(item.stemFull || item.stem) + '</p>' +
      (Array.isArray(item.options) ? '<ol class="ml-options" type="A">' + item.options.map(function (option) { return '<li>' + text(option) + '</li>'; }).join('') + '</ol>' : '') +
      (Array.isArray(item.tables) ? item.tables.map(function (table) {
        return '<div class="ml-table-wrap" tabindex="0" role="region" aria-label="' + esc(table.caption) + '"><table><caption>' + text(table.caption) +
          '</caption><thead><tr>' + table.headers.map(function (head) { return '<th scope="col">' + text(head) + '</th>'; }).join('') +
          '</tr></thead><tbody>' + table.rows.map(function (row) { return '<tr>' + row.map(function (cell) { return '<td>' + text(cell) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
      }).join('') : '') +
      figures.map(function (f) {
        return /^images\/(chem|bio|math|m2|physics)-\d{4}-fig-[a-z0-9-]+\.jpg$/.test(f.path) ? '<figure><img data-library-image="' + esc(f.path) +
          '" loading="lazy" decoding="async" alt="' + esc(f.alt || '原題圖表') + '"' +
          (f.width > 0 && f.height > 0 ? ' width="' + Number(f.width) + '" height="' + Number(f.height) + '"' : '') + '><figcaption>' + esc(f.alt) + '</figcaption></figure>' : '';
      }).join('') + '</div><div class="ml-reading-actions"><a class="btn btn-primary ml-redo-one" href="' + esc(drillHref(context.code,[item.id],returnBack)) + '">' + (item.kind === 'mc' ? '獨立重做這道選擇題' : '獨立重做這一題') + '</a></div>' +
      '<details class="ml-reveal" data-reading-id="answer-' + esc(item.id) + '"><summary>先回憶，再查看原答案、錯因與完整詳解</summary><div class="ml-reveal-body">' +
      '<div class="ml-answer ml-answer-own"><h3>我的原答案</h3><p>' + own + '</p></div>' +
      '<div class="ml-answer ml-answer-deduct"><h3>扣分點與錯因</h3><p>' + text(item.deduct) + '</p></div>' +
      '<div class="ml-answer ml-answer-correct"><h3>正解與踩分點</h3>' +
        (item.correctOpt || item.correct ? '<p>' + text(item.correctOpt || item.correct) + '</p>' : '') +
        (item.points ? '<p>' + text(item.points) + '</p>' : '') +
        (item.checks && item.checks.length ? '<ul>' + item.checks.map(function (p) { return '<li>' + text(p) + '</li>'; }).join('') + '</ul>' : '') + '</div>' +
      (row ? '<div class="ml-history"><h3>最近重做記錄</h3><p>與上方原卷答案分開記錄 · 連續全對 ' + row.streak + ' 次</p><ol>' +
        row.history.slice(-5).reverse().map(function (h) { return '<li>' + context.formatDate(h.t) + ' · ' +
          (h.correct ? '全對' : '未全對') + (h.tot ? ' · ' + esc(h.marks + '/' + h.tot) : '') + '</li>'; }).join('') + '</ol></div>' : '') +
      comparisonHtml(item) + (context.aiHtml ? context.aiHtml(item.id) : '') + '</div></details>' + personalNote(item) + '<div class="ml-reading-actions"><a class="btn btn-ghost" href="#/session/' + context.code + '/' + encodeURIComponent(item.topic) + (year ? '/' + encodeURIComponent(year) : '') + '">練習整個課題</a>' +
      '<a class="btn btn-ghost" href="#/library/books/concepts/' + context.code + '/' + encodeURIComponent(item.topic) + '">概念回顧</a></div></div></details>';
  }
  function questions(code, topicCode) {
    var api = context, subject = api.data.subjects[code], topic = subject.topics.filter(function (t) { return t.code === topicCode; })[0];
    if (!topic) return topicPage(code);
    var items = subject.items.filter(function (item) { return item.topic === topicCode; });
    var key = code + '/' + topicCode, f = Object.assign({ query:'', status:'', kind:'', year:selectedYears[code] && selectedYears[code] !== 'all' ? selectedYears[code] : '' },filters[key] || {}), limit = boundedLimit(f.limit,12);
    filters[key] = f; context.code = code;
    var years = sourceYears(items);
    frame(key, header(esc(topic.code + ' · ' + topic.name), '原答案、扣分點與正解放在一起，按需要展開閱讀。', '#/library/books/' + code, subjectName(code) + '課題') +
      summary(code, items, topic.name) + conceptPanel(code,topicCode,items) + '<div class="ml-filters"><label class="ml-search">搜尋<input id="mlSearch" type="search" placeholder="題號、題幹、錯因或答案" value="' + esc(f.query) + '"></label>' +
      '<label>狀態<select id="mlStatus"><option value="">全部狀態</option>' + states.map(function (s) { return '<option value="' + s.key + '">' + s.label + '</option>'; }).join('') + '</select></label>' +
      '<label>題型<select id="mlKind"><option value="">全部題型</option><option value="mc">選擇題</option><option value="sub">主觀題</option></select></label>' +
      '<label>年份<select id="mlYear"><option value="">全部年份</option>' + years.map(function (y) { return '<option value="' + esc(y) + '">' + esc(sourceInfo(y, null, items).label) + '</option>'; }).join('') + '</select></label></div>' +
      '<div class="ml-section-head"><p id="mlMatchCount" role="status" aria-live="polite"></p><div class="ml-reading-actions"><a class="btn btn-primary" id="mlFilteredPractice" hidden>練習篩選結果</a><a class="btn btn-ghost" id="mlPracticeLink" href="#/session/' + code + '/' + encodeURIComponent(topicCode) + '">練習整個課題</a></div></div>' +
      '<div id="mlQuestions"></div><button class="btn btn-ghost" id="mlMore" hidden type="button">顯示更多</button>');
    var root = context.root, search = root.querySelector('#mlSearch'), timer;
    ['Status', 'Kind', 'Year'].forEach(function (name) {
      var element = root.querySelector('#ml' + name); element.value = f[name.toLowerCase()];
      element.addEventListener('change', function () { f[name.toLowerCase()] = element.value; limit = 12; draw(); saveReading(); });
    });
    var normalized = items.map(function (item) {
      return { item: item, search: context.normalize([item.qref, item.stem, item.stemFull, item.deduct, item.correct, item.points,
        JSON.stringify(item.my || []), (item.options || []).join(' ')].join(' ')).toLowerCase() };
    });
    function draw() {
      if (activeKey !== key || context !== api) return;
      if (root.querySelector('#mlQuestions').innerHTML) captureReading();
      root.querySelector('#mlPracticeLink').href = '#/session/' + code + '/' + encodeURIComponent(topicCode) + (f.year ? '/' + encodeURIComponent(f.year) : '');
      var query = context.normalize(f.query.trim()).toLowerCase();
      var matches = normalized.filter(function (row) {
        var it = row.item, state = context.index[it.id];
        return (!f.status || (state ? state.state : 'unseen') === f.status) && (!f.kind || it.kind === f.kind) &&
          (!f.year || String(it.year) === f.year) && (!query || row.search.indexOf(query) >= 0);
      });
      f.limit = limit; selectionLink(root.querySelector('#mlFilteredPractice'),code,matches.map(function (row) { return row.item.id; }));
      root.querySelector('#mlMatchCount').textContent = matches.length + ' / ' + items.length + ' 張錯題卡';
      root.querySelector('#mlQuestions').innerHTML = matches.slice(0, limit).map(function (row) { return card(row.item, f.year); }).join('') || '<div class="empty-ok">沒有符合條件的錯題。</div>';
      root.querySelector('#mlMore').hidden = matches.length <= limit;
      restoreReading(key);
    }
    search.addEventListener('input', function () {
      f.query = search.value; clearTimeout(timer); timer = setTimeout(function () { limit = 12; draw(); saveReading(); }, 120);
    });
    root.querySelector('#mlMore').addEventListener('click', function () { limit += 12; draw(); saveReading(); });
    draw();
  }
  function conceptPanel(code, topicCode, items) {
    var count = conceptCards(items).length, mc = items.filter(function (item) { return item.kind === 'mc'; });
    return '<section class="panel ml-concept-panel"><h2>概念回顧 · 先回憶，再核對</h2><p>' + count + ' 張原文回憶卡，整理自本課題已核實的正解與得分要點。閱讀不計作答或掌握。</p><div class="ml-reading-actions">' +
      '<a class="btn btn-ghost" href="#/library/books/concepts/' + code + '/' + encodeURIComponent(topicCode) + '">打開概念回顧</a>' +
      (mc.length ? '<a class="btn btn-primary" href="' + esc(drillHref(code,mc.map(function (item) { return item.id; }))) + '">用本課題選擇題獨立檢驗</a>' : '<span class="review-note">本課題尚無選擇題，可在電腦獨立重做原題。</span>') + '</div></section>';
  }
  function concepts(code, topicCode) {
    var subjects = context.data.subjects, subject = subjects[code], base = '#/library/books/concepts';
    if (!subject) {
      return frame('concepts',header('概念回顧','從已核實的正解與得分要點回憶；閱讀不計作答。','#/library/books','錯題庫') +
        '<div class="ml-concept-directory">' + global.DSESubjects.libraryOrder(subjects).map(function (subjectCode) {
          return '<a class="ml-topic" href="' + base + '/' + subjectCode + '"><h2>' + esc(subjectName(subjectCode)) + '</h2><p>' + conceptCards(subjects[subjectCode].items).length + ' 張原文回憶卡 · 按課題閱讀 →</p></a>';
        }).join('') + '</div>');
    }
    var topic = subject.topics.filter(function (item) { return item.code === topicCode; })[0];
    if (!topic) return frame('concepts/' + code,header(esc(subjectName(code) + ' · 概念回顧'),'先選課題，再回憶題目要求的知識與得分要點。',base,'科目') +
      '<div class="ml-concept-directory">' + subject.topics.map(function (item) {
        var items = subject.items.filter(function (question) { return question.topic === item.code; }), count = conceptCards(items).length;
        return count ? '<a class="ml-topic" href="' + base + '/' + code + '/' + encodeURIComponent(item.code) + '"><h2>' + esc(item.code + ' · ' + item.name) + '</h2><p>' + count + ' 張原文回憶卡 →</p></a>' : '';
      }).join('') + '</div><p class="review-note">只列出已有得分要點原文的課題；不補造概念。</p>');
    var items = subject.items.filter(function (item) { return item.topic === topicCode; }), cards = conceptCards(items), key = 'concepts/' + code + '/' + topicCode;
    frame(key,header(esc(topic.code + ' · ' + topic.name),'先看題目，用自己的話回憶，再揭曉來源原文。閱讀不會增加掌握證據。',base + '/' + code,'課題') +
      conceptPanel(code,topicCode,items) + '<p class="review-note">卡片保留已核實資料原文，不代替完整詳解；點題源可查看完整題目、原答與扣分原因。</p>' +
      (cards.map(function (row) {
        return '<article class="panel ml-recall-card"><p class="ml-recall-source">' + row.sources.map(function (item) {
          return '<a href="#/library/books/question/' + code + '/' + encodeURIComponent(item.id) + '">' + esc(itemSource(item) + ' · ' + item.qref) + '</a>';
        }).join(' · ') + '</p><h2>回憶這道題的概念與得分要點</h2><p class="ml-recall-prompt">' + text(row.prompt) + '</p>' +
          '<details class="ml-recall" data-reading-id="' + esc(row.id) + '"><summary>回憶後，揭曉已核實原文</summary>' + row.excerpts.map(function (excerpt) {
            return '<section><h3>' + excerpt.label + '</h3><p>' + text(excerpt.value) + '</p></section>';
          }).join('') + '</details></article>';
      }).join('') || '<p class="review-note">此課題尚無可整理的得分要點原文，請先查看原題詳解。</p>'));
  }
  function searchText(item, topic, tags) {
    return [item.id,item.qref,item.stem,item.stemFull,topic && topic.name,item.topic,item.option,item.correctOpt,item.deduct,item.correct,item.points,
      (item.my || []).map(function (s) { return s[0]; }).join(' '),(item.checks || []).join(' '),(item.options || []).join(' '),JSON.stringify(item.tables || []),(tags || []).join(' ')].filter(Boolean).join('\n');
  }
  function searchRows(data, historyIndex, f, normalize, tagsFor) {
    var terms = normalize(f.query.trim()).toLowerCase().split(/\s+/).filter(Boolean), rows=[];
    Object.keys(data.subjects).forEach(function (code) {
      if(f.subject && f.subject!==code)return;
      var subject=data.subjects[code];
      subject.items.forEach(function (item) {
        var state=historyIndex[item.id], tags=tagsFor ? tagsFor(item.id) : [], topic=subject.topics.filter(function (t) { return t.code===item.topic; })[0];
        if((f.year && String(item.year)!==f.year)||(f.kind && item.kind!==f.kind)||(f.status && (state ? state.state : 'unseen')!==f.status)||(f.tag && tags.indexOf(f.tag)<0))return;
        var source=searchText(item,topic,tags), normalized=normalize(source).toLowerCase();
        if(terms.some(function (term) { return normalized.indexOf(term)<0; }))return;
        var first=terms.length ? normalized.indexOf(terms[0]) : 0, start=Math.max(0,first-36), snippet=source.slice(start,start+150);
        rows.push({code:code,item:item,topic:topic,state:state ? state.state : 'unseen',tags:tags,snippet:(start?'…':'')+snippet+(source.length>start+150?'…':'')});
      });
    });
    return rows;
  }
  function snippetHtml(value, query) {
    var terms=context.normalize(query.trim()).toLowerCase().split(/\s+/).filter(Boolean), normalized=context.normalize(value).toLowerCase(), ranges=[];
    terms.forEach(function (term) { var at=normalized.indexOf(term);if(at>=0)ranges.push([at,at+term.length]); });
    ranges.sort(function (a,b) { return a[0]-b[0]; });
    var html='',cursor=0;
    ranges.forEach(function (range) { if(range[0]<cursor)return;html+=esc(value.slice(cursor,range[0]))+'<mark>'+esc(value.slice(range[0],range[1]))+'</mark>';cursor=range[1]; });
    return html+esc(value.slice(cursor));
  }
  function globalSearch() {
    if(context.loaded===false) return frame('search',header('全局搜尋','跨科目與課題搜尋錯題。','#/library/books','錯題庫')+'<p role="status">題庫尚未載入，載入後可開始搜尋。</p>');
    var f=searchState, subjects=context.data.subjects;
    var years=Array.from(new Set(Object.values(subjects).reduce(function (all,s) {return all.concat(s.items.map(function (it) {return String(it.year);}));},[]))).sort().reverse();
    var tags=Array.from(new Set(Object.values(subjects).reduce(function (all,s) {return all.concat(s.items.reduce(function (a,it) {return a.concat(context.tags?context.tags(it.id):[]);},[]));},[])));
    frame('search',header('全局搜尋','跨科目、跨課題查題號、題幹、知識點、原答案、扣分原因與解析。','#/library/books','錯題庫')+
      '<div class="ml-filters ml-global-filters"><label class="ml-search">關鍵詞<input id="globalQuery" type="search" maxlength="200" placeholder="支援簡體／繁體；多個關鍵詞以空格分隔" value="'+esc(f.query)+'"></label>'+
      '<label>科目<select id="globalSubject"><option value="">全部科目</option>'+Object.keys(subjects).map(function (code) {return '<option value="'+code+'">'+subjectName(code)+'</option>';}).join('')+'</select></label>'+
      '<label>年份<select id="globalYear"><option value="">全部年份</option>'+years.map(function (year) {return '<option>'+esc(year)+'</option>';}).join('')+'</select></label>'+
      '<label>題型<select id="globalKind"><option value="">全部題型</option><option value="mc">選擇題</option><option value="sub">主觀題</option></select></label>'+
      '<label>掌握狀態<select id="globalStatus"><option value="">全部狀態</option>'+states.map(function (s) {return '<option value="'+s.key+'">'+s.label+'</option>';}).join('')+'</select></label>'+
      '<label>已確認錯因<select id="globalTag"><option value="">全部標籤</option>'+tags.map(function (tag) {return '<option>'+esc(tag)+'</option>';}).join('')+'</select></label></div>'+
      '<div class="ml-section-head"><p id="globalCount" role="status" aria-live="polite"></p><a id="globalPractice" class="btn btn-primary" hidden>練習篩選結果</a></div><div class="ml-global-results" id="globalResults"></div><button id="globalMore" class="btn btn-ghost" type="button" hidden>顯示更多結果</button>');
    var api=context, root=api.root, timer;
    function draw() {
      if(context!==api || activeKey!=='search')return;
      var rows=searchRows(api.data,api.index,f,api.normalize,api.tags);
      selectionLink(root.querySelector('#globalPractice'),f.subject || 'all',rows.map(function (row) {return row.item.id;}));
      root.querySelector('#globalCount').textContent=rows.length+' 題符合條件'+(tags.length?'':' · 尚未有已確認的錯因標籤');
      root.querySelector('#globalResults').innerHTML=rows.slice(0,f.limit).map(function (r) {
        return '<a class="ml-search-result" href="#/library/books/question/'+r.code+'/'+encodeURIComponent(r.item.id)+'"><span class="ml-result-meta">'+esc(subjectName(r.code)+' · '+sourceInfo(r.item.year,r.item).label+' · '+r.item.topic+' '+(r.topic?r.topic.name:'')+' · '+r.item.qref)+'</span>'+badge(r.state)+
          '<h2>'+esc(r.item.stem)+'</h2><p>'+snippetHtml(r.snippet,f.query)+'</p>'+(r.tags.length?'<small>已確認錯因：'+esc(r.tags.join('、'))+'</small>':'')+'</a>';
      }).join('') || '<div class="empty-note">沒有匹配結果。可減少關鍵詞或放寬篩選條件。</div>';
      root.querySelector('#globalMore').hidden=rows.length<=f.limit;
    }
    root.querySelector('#globalQuery').addEventListener('input',function (event) {f.query=event.target.value;f.limit=20;saveReading();clearTimeout(timer);timer=setTimeout(draw,120);});
    ['Subject','Year','Kind','Status','Tag'].forEach(function (name) {
      var element=root.querySelector('#global'+name);element.value=f[name.toLowerCase()];
      element.addEventListener('change',function () {f[name.toLowerCase()]=element.value;f.limit=20;draw();saveReading();});
    });
    root.querySelector('#globalMore').addEventListener('click',function () {f.limit+=20;draw();saveReading();});
    draw();
  }
  function questionPage(code, id) {
    var subject=context.data.subjects[code], item=subject && subject.items.filter(function (it) {return it.id===id;})[0];
    if(!item)return frame('question',header('未找到這道題','請返回搜尋結果或重新載入題庫。','#/library/books/search','搜尋結果'));
    context.code=code;
    var back = questionBack();
    frame('question/'+code+'/'+id,header(esc(subjectName(code)+' · '+sourceInfo(item.year,item).label+' · '+item.qref),'原卷答案與重做、AI 輔評分開保存。',back || '#/library/books/search',back ? '原來的複習位置' : '搜尋結果')+card(item,'',back));
    var detail=context.root.querySelector('.ml-question');
    if(detail){detail.open=true;Array.prototype.forEach.call(detail.querySelectorAll('[data-library-image]'),function (img) {img.setAttribute('data-bank-image',img.getAttribute('data-library-image'));img.removeAttribute('data-library-image');});if(context.hydrate)context.hydrate(detail);}
    restoreReading('question/'+code+'/'+id);
  }
  function render(parts, api) {
    chooseUser(api.userId); context = api; context.index = indexHistory(api.history);
    if(parts[0]==='concepts') { try { return concepts(parts[1],decodeURIComponent(parts[2]||'')); } catch (_) { return concepts(); } }
    if(parts[0]==='search')return globalSearch();
    if(parts[0]==='question') {try{return questionPage(parts[1],decodeURIComponent(parts[2]||''));}catch(_){return overview();}}
    if (!parts.length || !api.data.subjects[parts[0]]) return overview();
    if (parts.length === 1) return topicPage(parts[0]);
    var topic;
    try { topic = decodeURIComponent(parts[1]); } catch (_) { return topicPage(parts[0]); }
    return questions(parts[0], topic);
  }
  function reset() { clearReading(); context = null; activeKey = ''; memoryUser = ''; positions = {}; filters = {}; selectedYears = {};searchState=blankSearch(); topicGeneration++; }
  global.DSELibrary = { render: render, remember: remember, reset: reset, independentHistory: independentHistory, indexHistory: indexHistory, summarize: summarize, full: full, dailyCandidates: dailyCandidates, searchRows: searchRows,
    sourceInfo: sourceInfo, compareSources: compareSources, sourceYears: sourceYears, itemSource: itemSource, practiceRubric: practiceRubric, practiceScore: practiceScore, attemptSnapshot: attemptSnapshot, independentAttempt: independentAttempt,
    drillHref:drillHref, conceptCards:conceptCards, submittedAnswers:submittedAnswers };
})(window);

