(function () {
  'use strict';
  // Page shells stay in the document; only nearby full-size images stay decoded.
  window.DSEPaperReader = function (options) {
    var root = options.root, scroll = options.scrollRoot, thumbs = options.thumbs;
    var manifest = options.manifest, initial = options.initialPosition || {}, stopped = false;
    var current = Number.isInteger(initial.page) ? initial.page : (options.page || 1);
    current = Math.max(1, Math.min(manifest.pages, current));
    var rows = [], queue = [], active = 0, frame = null, atlasUrl = null, warmTimer;
    var atlas = manifest.thumbnails, sections = manifest.sections || [], resizeObserver;
    var lastWidth = root.clientWidth, lastHeight = root.scrollHeight;
    var anchorFraction = Number.isFinite(initial.fraction) ? Math.max(0, Math.min(0.99, initial.fraction)) : 0;
    var mistakes = (manifest.mistakes || []).filter(function (m) {
      return Number.isInteger(m.page) && m.page > 0 && m.page <= manifest.pages &&
        Number.isFinite(m.x) && m.x >= 0 && m.x < 1 && Number.isFinite(m.y) && m.y >= 0 && m.y < 1;
    }).sort(function (a, b) { return a.page - b.page || a.y - b.y; });
    var lastJump = null, marker = null, activeMistake = null, lastPosition = '';
    var zoom = null, zoomUrl = null, zoomGeneration = 0;
    if (typeof initial.mistakeLabel === 'string') activeMistake = mistakes.filter(function (m) {
      return m.page === current && m.label === initial.mistakeLabel;
    })[0] || null;
    function readingTop() {
      return Math.max(scroll.getBoundingClientRect().top, options.toolbar.getBoundingClientRect().bottom) + 24;
    }
    function getPosition() {
      return { page: current, fraction: anchorFraction,
        mistakeLabel: activeMistake && activeMistake.page === current ? activeMistake.label : undefined };
    }
    function publishPosition() {
      var position = getPosition(), signature = JSON.stringify(position);
      if (!stopped && options.onPosition && signature !== lastPosition) {
        lastPosition = signature; options.onPosition(position);
      }
    }
    function restoreAnchor() {
      if (!rows[current - 1] || !rows[current - 1].sheet.getBoundingClientRect) return;
      var box = rows[current - 1].sheet.getBoundingClientRect();
      scroll.scrollTop += box.top + anchorFraction * box.height - readingTop();
    }
    function measureToolbar() {
      if (options.toolbar.getBoundingClientRect) options.toolbar.parentElement.style.setProperty('--paper-toolbar-height', options.toolbar.getBoundingClientRect().height + 'px');
    }
    function label(page) {
      var section = sections.filter(function (s) { return s.page <= page; }).pop();
      return '第 ' + page + ' 頁' + (section ? ' · ' + section.label : '');
    }
    function escape(value) { return String(value).replace(/[&<>"']/g, function (c) { return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]; }); }
    root.innerHTML = Array.from({ length: manifest.pages }, function (_, index) {
      var n = index + 1, size = manifest.page_sizes && manifest.page_sizes[index];
      var ratio = size ? size[0] / size[1] : 1 / Math.sqrt(2);
      return '<figure class="paper-sheet" id="paperSheet-' + n + '" aria-label="' + escape(label(n)) + '">' +
        '<figcaption>' + escape(label(n)) + '</figcaption><div class="paper-sheet-body" style="aspect-ratio:' + ratio + '">' +
        '<span class="paper-placeholder" id="paperPlaceholder-' + n + '">第 ' + n + ' 頁</span>' +
        '<img id="paperImage-' + n + '" alt="' + escape(options.title + ' ' + label(n)) + '" decoding="async" hidden>' +
        '<button type="button" class="paper-page-retry" id="paperRetry-' + n + '" hidden>載入失敗，點此重試</button></div></figure>';
    }).join('');
    thumbs.innerHTML = Array.from({ length: manifest.pages }, function (_, index) {
      return '<button class="paper-thumb" type="button" id="paperThumb-' + (index + 1) + '" data-page="' + (index + 1) +
        '" aria-label="' + escape(label(index + 1)) + '"><span class="paper-thumb-preview" id="paperPreview-' + (index + 1) +
        '" aria-hidden="true"></span><span>' + (index + 1) + '</span></button>';
    }).join('');
    for (var n = 1; n <= manifest.pages; n++) {
      var row = { page: n, state: 'idle', url: null, sheet: root.querySelector('#paperSheet-' + n),
        image: root.querySelector('#paperImage-' + n), placeholder: root.querySelector('#paperPlaceholder-' + n),
        retry: root.querySelector('#paperRetry-' + n), thumb: thumbs.querySelector('#paperThumb-' + n),
        preview: thumbs.querySelector('#paperPreview-' + n) };
      (function (r) {
        r.retry.addEventListener('click', function () { r.state = 'idle'; ensure(r.page, true); });
        r.image.addEventListener('dblclick', function () { openZoom(r.page); });
        r.thumb.addEventListener('click', function () { go(r.page); if (options.onNavigate) options.onNavigate(); });
        r.thumb.addEventListener('keydown', function (event) {
          var target = event.key === 'ArrowDown' ? r.page + 1 : event.key === 'ArrowUp' ? r.page - 1 :
            event.key === 'Home' ? 1 : event.key === 'End' ? manifest.pages : 0;
          if (target >= 1 && target <= manifest.pages) { event.preventDefault(); go(target); rows[target - 1].thumb.focus(); }
        });
      })(row);
      rows.push(row);
    }
    function notify() {
      rows.forEach(function (r) { r.thumb.setAttribute('aria-current', r.page === current ? 'page' : 'false'); r.thumb.tabIndex = r.page === current ? 0 : -1; });
      var thumb = rows[current - 1].thumb;
      if (thumb.getBoundingClientRect && thumbs.getBoundingClientRect) {
        var t = thumb.getBoundingClientRect(), area = thumbs.getBoundingClientRect();
        if (t.top < area.top || t.bottom > area.bottom) thumbs.scrollTop += t.top - area.top - (area.height - t.height) / 2;
      }
      options.onPage(current, rows[current - 1].url);
    }
    function evict() {
      rows.forEach(function (r) {
        if (r.url && Math.abs(r.page - current) > 3) {
          r.image.onload = r.image.onerror = null;
          r.image.hidden = true; r.image.removeAttribute('src');
          if (!atlas) r.preview.style.backgroundImage = '';
          URL.revokeObjectURL(r.url); r.url = null; r.state = 'idle'; r.placeholder.hidden = false;
        }
      });
    }
    function ensure(page, priority) {
      var r = rows[page - 1];
      if (!r || stopped || r.state !== 'idle') return;
      r.state = 'queued';
      if (priority) queue.unshift(r); else queue.push(r);
      pump();
    }
    function pump() {
      if (stopped) return;
      while (active < 2 && queue.length) {
        var r = queue.shift();
        if (Math.abs(r.page - current) > 3) { r.state = 'idle'; continue; }
        active++; r.state = 'loading'; r.retry.hidden = true;
        r.placeholder.textContent = '正在載入第 ' + r.page + ' 頁…';
        (function (row) {
          options.loadPage(row.page).then(function (blob) {
            if (stopped) return;
            if (Math.abs(row.page - current) > 3) { row.state = 'idle'; return; }
            row.url = URL.createObjectURL(blob);
            var assignedUrl = row.url;
            row.image.onload = function () {
              if (!stopped && row.url === assignedUrl) { row.placeholder.hidden = true; row.image.hidden = false; }
            };
            row.image.onerror = function () { if (!stopped && row.url === assignedUrl) fail(row, new Error('頁面圖片未能顯示')); };
            row.image.hidden = true; row.image.src = row.url; row.state = 'ready';
            if (!atlas) row.preview.style.backgroundImage = 'url("' + row.url + '")';
            if (row.page === current) options.onPage(current, row.url);
            evict();
          }).catch(function (error) {
            if (stopped) return;
            if (error.name === 'AbortError' && Math.abs(row.page - current) > 3) {
              row.state = 'idle'; row.placeholder.textContent = '第 ' + row.page + ' 頁';
            } else fail(row, error);
          }).finally(function () { active--; pump(); });
        })(r);
      }
    }
    function fail(row, error) {
      if (row.url) { URL.revokeObjectURL(row.url); row.url = null; }
      row.image.hidden = true; row.image.removeAttribute('src'); row.state = 'error'; row.retry.hidden = false;
      row.placeholder.hidden = true;
      if (row.page === current) { options.onPage(current, null); options.onError(error); }
    }
    function nearby() { ensure(current, true); ensure(current + 1); ensure(current - 1); evict(); }
    function track() {
      frame = null;
      if (stopped || !root.getBoundingClientRect) return;
      // A pending scroll frame can run before ResizeObserver after a style change.
      // Restore the existing anchor before deciding which page is now visible.
      if (lastWidth && (root.clientWidth !== lastWidth || (lastHeight && root.scrollHeight !== lastHeight))) {
        resize(); return;
      }
      var top = readingTop();
      var next = current;
      for (var i = 0; i < rows.length; i++) {
        var box = rows[i].sheet.getBoundingClientRect();
        if (box.top <= top) next = i + 1;
        else break;
      }
      if (scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 2) next = manifest.pages;
      if (next !== current) { current = next; notify(); }
      var currentBox = rows[current - 1].sheet.getBoundingClientRect();
      if (currentBox.height > 0) anchorFraction = Math.max(0, Math.min(0.99, (top - currentBox.top) / currentBox.height));
      if (activeMistake && activeMistake.page !== current) activeMistake = null;
      nearby(); publishPosition();
    }
    function schedule() {
      if (stopped || frame !== null) return;
      frame = window.requestAnimationFrame ? window.requestAnimationFrame(track) : setTimeout(track, 16);
    }
    function go(page, position) {
      if (stopped || !Number.isInteger(page) || page < 1 || page > manifest.pages) return;
      clearTimeout(warmTimer); lastJump = null; activeMistake = null;
      if (marker) { marker.remove(); marker = null; }
      current = page; anchorFraction = 0; notify();
      if (rows[page - 1].sheet.getBoundingClientRect) {
        var targetTop = scroll.getBoundingClientRect().top + options.toolbar.getBoundingClientRect().height + 16;
        var body = rows[page - 1].sheet.querySelector('.paper-sheet-body');
        var box = position ? body.getBoundingClientRect() : rows[page - 1].sheet.getBoundingClientRect();
        var delta = box.top + (position ? position.y * box.height : 0) - targetTop;
        scroll.scrollTop += delta;
        var currentBox = rows[page - 1].sheet.getBoundingClientRect();
        if (currentBox.height > 0) anchorFraction = Math.max(0, Math.min(0.99, (readingTop() - currentBox.top) / currentBox.height));
        if (position) {
          marker = document.createElement('span'); marker.className = 'paper-mistake-marker';
          marker.setAttribute('aria-hidden', 'true');
          marker.style.left = position.x * 100 + '%'; marker.style.top = position.y * 100 + '%';
          body.appendChild(marker);
        }
      }
      nearby(); publishPosition();
    }
    function jumpMistake(index, wrapped) {
      var mistake = mistakes[index];
      if (stopped || !mistake) return null;
      go(mistake.page, mistake);
      activeMistake = mistake;
      lastJump = { index: index, scrollTop: scroll.scrollTop };
      var target = Object.assign({}, mistake, { index: index + 1, total: mistakes.length, wrapped: !!wrapped });
      if (options.onMistake) options.onMistake(target);
      publishPosition(); return target;
    }
    // Numeric indexes are one-based, matching the visible question counter.
    function goMistake(target) {
      var index = Number.isInteger(target) ? target - 1 : mistakes.findIndex(function (mistake) {
        return target && (mistake === target || (mistake.page === target.page && mistake.label === target.label &&
          (!target.question_id || mistake.question_id === target.question_id)));
      });
      return jumpMistake(index, false);
    }
    function nextMistake() {
      if (stopped || !mistakes.length) return null;
      var top = Math.max(scroll.getBoundingClientRect().top, options.toolbar.getBoundingClientRect().bottom) + 16;
      var index = -1;
      if (lastJump && Math.abs(scroll.scrollTop - lastJump.scrollTop) < 3) index = lastJump.index + 1;
      else index = mistakes.findIndex(function (m) {
        if (m.page < current) return false;
        var box = rows[m.page - 1].sheet.querySelector('.paper-sheet-body').getBoundingClientRect();
        return box.top + m.y * box.height > top + 8;
      });
      var wrapped = index < 0 || index >= mistakes.length;
      if (wrapped) index = 0;
      return jumpMistake(index, wrapped);
    }
    function closeZoom(restoreFocus) {
      zoomGeneration++;
      if (!zoom) return;
      var previous = zoom; zoom = null;
      previous.image.onload = previous.image.onerror = null;
      previous.image.removeAttribute('src');
      if (zoomUrl) { URL.revokeObjectURL(zoomUrl); zoomUrl = null; }
      if (previous.dialog.open && previous.dialog.close) previous.dialog.close();
      previous.dialog.remove();
      if (!stopped) {
        current = previous.position.page; anchorFraction = previous.position.fraction;
        restoreAnchor(); publishPosition();
        if (restoreFocus !== false && previous.trigger && previous.trigger.isConnected !== false && previous.trigger.focus) {
          previous.trigger.focus({ preventScroll: true });
        }
      }
    }
    function openZoom(page, target) {
      page = Number.isInteger(page) ? page : current;
      if (stopped || page < 1 || page > manifest.pages || typeof document === 'undefined' || !document.createElement || !document.body) return false;
      closeZoom(false);
      var trigger = document.activeElement, position = getPosition(), generation = ++zoomGeneration;
      var dialog = document.createElement('dialog');
      dialog.className = 'paper-zoom';
      dialog.setAttribute('aria-label', label(page) + ' · 站內放大');
      dialog.innerHTML = '<div class="paper-zoom-head"><strong>' + escape(label(page)) + '</strong>' +
        '<div class="paper-zoom-controls"><button class="btn btn-ghost" type="button" data-zoom="out" aria-label="縮小本頁">−</button>' +
        '<button class="btn btn-ghost" type="button" data-zoom="fit">適合寬度</button>' +
        '<button class="btn btn-ghost" type="button" data-zoom="in" aria-label="放大本頁">＋</button>' +
        '<button class="btn btn-primary" type="button" data-zoom="close">關閉放大</button></div></div>' +
        '<p class="paper-zoom-status" role="status" aria-live="polite">正在載入清晰頁面…</p>' +
        '<div class="paper-zoom-viewport" tabindex="0" aria-label="放大頁面，可左右及上下捲動">' +
        '<img class="paper-zoom-image" alt="' + escape(options.title + ' ' + label(page)) + '" draggable="false" hidden>' +
        '<button class="btn btn-ghost paper-zoom-retry" type="button" hidden>重新載入本頁</button></div>';
      document.body.appendChild(dialog);
      var viewport = dialog.querySelector('.paper-zoom-viewport'), image = dialog.querySelector('.paper-zoom-image');
      var status = dialog.querySelector('.paper-zoom-status'), retry = dialog.querySelector('.paper-zoom-retry');
      var scale = 2, focusPoint = target || (activeMistake && activeMistake.page === page ? activeMistake : null);
      var state = zoom = { dialog: dialog, image: image, trigger: trigger, position: position };
      function currentZoom() { return !stopped && zoom === state && generation === zoomGeneration; }
      function applyScale(next, center) {
        if (!currentZoom()) return;
        var previousWidth = image.clientWidth || 1, previousHeight = image.clientHeight || 1;
        var x = (viewport.scrollLeft + viewport.clientWidth / 2) / previousWidth;
        var y = (viewport.scrollTop + viewport.clientHeight / 2) / previousHeight;
        scale = Math.max(1, Math.min(4, next));
        image.style.width = Math.max(1, (viewport.clientWidth || root.clientWidth || 360) - 24) * scale + 'px';
        status.textContent = Math.round(scale * 100) + '% · 可拖動或捲動查看；關閉後返回原閱讀位置。';
        dialog.querySelector('[data-zoom="out"]').disabled = scale <= 1;
        dialog.querySelector('[data-zoom="in"]').disabled = scale >= 4;
        if (center && focusPoint) { x = focusPoint.x; y = focusPoint.y; }
        viewport.scrollLeft = Math.max(0, x * image.clientWidth - viewport.clientWidth / 2);
        viewport.scrollTop = Math.max(0, y * image.clientHeight - viewport.clientHeight / 2);
      }
      state.resize = function () { if (!image.hidden) applyScale(scale); };
      function failed() {
        if (!currentZoom()) return;
        image.hidden = true; retry.hidden = false;
        status.textContent = '本頁暫時未能載入；可重試，或關閉後繼續閱讀。';
      }
      function assign(url) {
        if (!currentZoom()) return;
        image.onload = function () {
          if (!currentZoom()) return;
          image.hidden = false; retry.hidden = true; applyScale(scale, true);
          viewport.focus({ preventScroll: true });
        };
        image.onerror = failed; image.src = url;
      }
      function loadZoom() {
        if (!currentZoom()) return;
        retry.hidden = true; status.textContent = '正在載入清晰頁面…';
        var row = rows[page - 1];
        if (row.url) { assign(row.url); return; }
        Promise.resolve().then(function () { return options.loadPage(page); }).then(function (blob) {
          if (!currentZoom()) return;
          if (zoomUrl) URL.revokeObjectURL(zoomUrl);
          zoomUrl = URL.createObjectURL(blob); assign(zoomUrl);
        }).catch(failed);
      }
      dialog.querySelector('[data-zoom="close"]').addEventListener('click', function () { closeZoom(); });
      dialog.querySelector('[data-zoom="out"]').addEventListener('click', function () { applyScale(scale - 0.5); });
      dialog.querySelector('[data-zoom="in"]').addEventListener('click', function () { applyScale(scale + 0.5); });
      dialog.querySelector('[data-zoom="fit"]').addEventListener('click', function () { applyScale(1); viewport.scrollLeft = 0; viewport.scrollTop = 0; });
      retry.addEventListener('click', loadZoom);
      dialog.addEventListener('cancel', function (event) { event.preventDefault(); closeZoom(); });
      dialog.addEventListener('click', function (event) { if (event.target === dialog) closeZoom(); });
      dialog.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') { event.preventDefault(); closeZoom(); }
        if (!event.ctrlKey && !event.metaKey && (event.key === '+' || event.key === '=' || event.key === '-')) {
          event.preventDefault(); applyScale(scale + (event.key === '-' ? -0.5 : 0.5));
        }
        if (event.key === 'Tab' && !dialog.showModal) {
          var controls = Array.prototype.filter.call(dialog.querySelectorAll('button,[tabindex="0"]'), function (control) { return !control.hidden && !control.disabled; });
          var first = controls[0], last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      });
      var drag = null;
      viewport.addEventListener('pointerdown', function (event) {
        if (event.target !== image || event.pointerType === 'touch' || event.button !== 0 || scale <= 1) return;
        drag = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
        if (viewport.setPointerCapture) viewport.setPointerCapture(event.pointerId);
        event.preventDefault();
      });
      viewport.addEventListener('pointermove', function (event) {
        if (!drag) return;
        viewport.scrollLeft = drag.left - event.clientX + drag.x;
        viewport.scrollTop = drag.top - event.clientY + drag.y;
      });
      function endDrag() { drag = null; }
      viewport.addEventListener('pointerup', endDrag); viewport.addEventListener('pointercancel', endDrag);
      if (dialog.showModal) dialog.showModal();
      else { dialog.setAttribute('open', ''); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); }
      dialog.querySelector('[data-zoom="close"]').focus({ preventScroll: true });
      loadZoom(); return true;
    }
    scroll.addEventListener('scroll', schedule, { passive: true });
    function resize() {
      measureToolbar();
      if (zoom && zoom.resize) zoom.resize();
      var width = root.clientWidth, height = root.scrollHeight;
      if (lastWidth && (width !== lastWidth || (lastHeight && height !== lastHeight)) && root.getBoundingClientRect) {
        restoreAnchor();
      }
      lastWidth = width; lastHeight = height; schedule();
    }
    window.addEventListener('resize', resize);
    measureToolbar();
    if (window.ResizeObserver) { resizeObserver = new window.ResizeObserver(resize); resizeObserver.observe(options.toolbar); resizeObserver.observe(root); }
    notify(); ensure(current, true);
    if (Number.isInteger(initial.page)) restoreAnchor();
    publishPosition();
    if (activeMistake && options.onMistake) options.onMistake(Object.assign({}, activeMistake, {
      index: mistakes.indexOf(activeMistake) + 1, total: mistakes.length, wrapped: false
    }));
    warmTimer = setTimeout(function () {
      if (stopped) return;
      if (Number.isInteger(initial.page)) { restoreAnchor(); nearby(); publishPosition(); }
      else if (current > 1) go(current);
      else nearby();
    }, 200);
    if (atlas && options.loadThumbnails) {
      options.loadThumbnails().then(function (blob) {
        if (stopped) return;
        atlasUrl = URL.createObjectURL(blob);
        rows.forEach(function (r, index) {
          var x = index % atlas.columns, y = Math.floor(index / atlas.columns);
          r.preview.style.backgroundImage = 'url("' + atlasUrl + '")';
          r.preview.style.backgroundSize = (atlas.columns * 100) + '% ' + (atlas.rows * 100) + '%';
          r.preview.style.backgroundPosition = (atlas.columns === 1 ? 0 : x / (atlas.columns - 1) * 100) + '% ' +
            (atlas.rows === 1 ? 0 : y / (atlas.rows - 1) * 100) + '%';
        });
      }).catch(function () { if (!stopped && options.onThumbnailError) options.onThumbnailError(); });
    }
    return { go: go, nextMistake: nextMistake, goMistake: goMistake, openZoom: openZoom, closeZoom: closeZoom,
      getPosition: function () { if (!stopped && root.getBoundingClientRect) track(); return getPosition(); },
      layoutChange: function (change) { change(); resize(); }, destroy: function () {
      closeZoom(false);
      stopped = true; clearTimeout(warmTimer); queue = [];
      scroll.removeEventListener('scroll', schedule); window.removeEventListener('resize', resize);
      if (resizeObserver) resizeObserver.disconnect();
      if (frame !== null) { if (window.cancelAnimationFrame) window.cancelAnimationFrame(frame); else clearTimeout(frame); }
      rows.forEach(function (r) { r.image.onload = r.image.onerror = null; if (r.url) URL.revokeObjectURL(r.url); r.image.removeAttribute('src'); r.preview.style.backgroundImage = ''; });
      if (atlasUrl) URL.revokeObjectURL(atlasUrl);
    } };
  };
})();
