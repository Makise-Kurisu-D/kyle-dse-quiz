/* Study navigation helpers. Contains no private questions or learning records. */
(function (global) {
  'use strict';
  function query(hash) {
    var out = {}, source = String(hash || '').split('?').slice(1).join('?');
    source.split('&').forEach(function (pair) {
      var i = pair.indexOf('=');
      if (i < 0) return;
      try { out[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1).replace(/\+/g, ' ')); } catch (_) {}
    });
    return out;
  }
  function safeRoute(value, fallback) {
    var authQuery = String(value || '').split('?').slice(1).join('?').split('&').some(function (pair) {
      var key = pair.split('=')[0];
      try { key = decodeURIComponent(key); } catch (_) {}
      return /^(?:handoff|sync)$/i.test(key);
    });
    var allowed = typeof value === 'string' && value.length <= 24000 && /^#\/(?:$|(?:practice|session|today|drill|random|library|records)(?:[/?]|$))/.test(value) &&
      !/[\u0000-\u001f<>]/.test(value) && !authQuery;
    return allowed ? value : fallback || '#/';
  }
  function drillHref(code, ids, back, draft) {
    return '#/drill/' + encodeURIComponent(code) + '?ids=' + encodeURIComponent(ids.join(',')) +
      '&back=' + encodeURIComponent(safeRoute(back)) + (draft ? '&draft=' + encodeURIComponent(draft) : '');
  }
  function reference(value) {
    var s = String(value || '').toLowerCase().replace(/[（]/g, '(').replace(/[）]/g, ')').replace(/\s+/g, '').replace(/\([0-9.]+(?:分|marks?)\)/g, '').replace(/\*/g, '');
    var match = s.match(/(?:mc|選擇題?|选择题?)[.：:]?(\d+)/);
    if (match) return 'mc' + Number(match[1]);
    // Prefer the explicit question number over a preceding paper number/year.
    match = s.match(/q[.：:]?(\d+)((?:\([a-z0-9]+\)|[a-z]+)*)/) ||
      s.match(/第(\d+)[題题]?((?:\([a-z0-9]+\)|[a-z]+)*)/) ||
      s.match(/(?:^|[^0-9])(\d+)(?:[.、題题])?((?:\([a-z0-9]+\)|[a-z]+)*)/);
    return match ? 'q' + Number(match[1]) + match[2].replace(/[^a-z0-9]/g, '') : '';
  }
  function paperMatches(target, items, year, paperId) {
    target = target || {};
    var pool = (items || []).filter(function (item) {
      return String(item.year) === String(year) && (paperId ? item.paper_id === paperId : !item.paper_id);
    });
    var id = String(target.question_id || ''), direct = pool.filter(function (it) { return it.id === id; });
    if (direct.length) return direct;
    var source = String(target.label || '').toLowerCase().replace(/（/g, '(').replace(/）/g, ')').replace(/\s+/g, '');
    var range = source.match(/(?:q|第)?(\d+)[題题]?\(([a-z])\)[\-–—−~～至](?:(?:q|第)?(\d+)[題题]?)?\(([a-z])\)/);
    if (range) {
      if ((range[3] && Number(range[3]) !== Number(range[1])) || range[2] > range[4]) return [];
      var parent = 'q' + Number(range[1]);
      return pool.filter(function (it) {
        var parts = reference(it.qref).match(/^(q\d+)([a-z])/);
        return !!parts && parts[1] === parent && parts[2] >= range[2] && parts[2] <= range[4];
      });
    }
    // Unrecognised multi-part expressions must not silently select a whole question.
    if (/\)[\-–—−~～至、,，;/／]/.test(source)) return [];
    var label = reference(target.label), base = /^(?:q[.：:]?\d|mc[.：:]?\d|第\d|\d)/i.test(id.trim()) ? reference(id) : '';
    var exact = pool.filter(function (it) { return label && reference(it.qref) === label; });
    if (exact.length) return exact;
    // A bare parent annotation covers its subquestions; a missing exact subpart
    // must not fall back to unrelated siblings from question_id.
    var parentRef = /^(?:mc\d+|q\d+)$/.test(label) ? label : !label && /^(?:mc\d+|q\d+)$/.test(base) ? base : '';
    return pool.filter(function (it) {
      var ref = reference(it.qref), stem = ref.match(/^(mc\d+|q\d+)/);
      return !!parentRef && !!stem && stem[0] === parentRef;
    });
  }
  function answered(item, draft) {
    draft = draft || {};
    var deletedAt = Number(draft.deletedAt) || 0;
    function current(kind) { return !deletedAt || (Number((draft.changedAt || {})[kind + ':' + item.id]) || 0) > deletedAt; }
    return item.kind === 'mc' ? current('pick') && /^[A-D]$/.test((draft.pick || {})[item.id] || '') :
      !!((current('text') && String((draft.text || {})[item.id] || '').trim()) || (current('paper') && (draft.paper || {})[item.id] === true));
  }
  function draftTask(drafts, data) {
    var best = null, subjects = data && data.subjects || {};
    Object.keys(drafts || {}).forEach(function (key) {
      var d = drafts[key] || {}, code = key.split(':')[0], subject = subjects[code];
      var pool = code === 'all' ? Object.keys(subjects).reduce(function (all, c) { return all.concat(subjects[c].items); }, []) : subject && subject.items;
      if (!pool) return;
      var ids = pool.filter(function (item) { return answered(item, d); }).map(function (it) { return it.id; });
      if (!ids.length) return;
      var at = Math.max.apply(Math, [0].concat(ids.reduce(function (all, id) {
        return all.concat(['pick', 'text', 'paper', 'steps'].map(function (kind) { return Number((d.changedAt || {})[kind + ':' + id]) || 0; }));
      }, []).filter(Number.isFinite)));
      if (!best || at > best.at) best = { code: code, ids: ids, draft: key, at: at,
        href: drillHref(code, ids, '#/', key) };
    });
    return best;
  }
  global.DSEStudy = { query: query, safeRoute: safeRoute, drillHref: drillHref, paperMatches: paperMatches,
    reference: reference, answered: answered, draftTask: draftTask };
})(window);
