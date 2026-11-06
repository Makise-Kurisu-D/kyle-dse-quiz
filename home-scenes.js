/* Two home scenes share the same scroll pane; only their boundary pages. */
(function () {
  'use strict';

  var pane = document.getElementById('contentScroll');
  var world = document.getElementById('visualWorld');
  var app = document.getElementById('app');
  var root = document.documentElement;
  if (!pane || !world || !app) return;

  var paintFrame = 0, animationFrame = 0, unlockTimer = 0, resetTimer = 0;
  var locked = false, lockedUntil = 0, lastWheel = 0, wheelDistance = 0, wheelDirection = 0;

  function homeDetails() {
    return root.dataset.appearance === 'full' && document.body.dataset.view === 'home'
      ? app.querySelector('#homeDetails') : null;
  }
  function detailsTop(details) {
    return details.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop;
  }
  function paint() {
    paintFrame = 0;
    var details = homeDetails(), progress = 0;
    if (details && pane.clientHeight) {
      var end = detailsTop(details);
      var start = Math.max(0, end - pane.clientHeight);
      progress = Math.max(0, Math.min(1, (pane.scrollTop - start) / Math.max(1, end - start)));
    }
    world.style.setProperty('--home-scene-progress', String(progress));
  }
  function schedulePaint() {
    if (!paintFrame) paintFrame = requestAnimationFrame(paint);
  }
  function resetWheel() {
    wheelDistance = 0;
    wheelDirection = 0;
    clearTimeout(resetTimer);
  }
  function cancelPaging() {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    clearTimeout(unlockTimer);
    locked = false;
    resetWheel();
  }
  function waitForGestureEnd() {
    clearTimeout(unlockTimer);
    var remaining = Math.max(lockedUntil - performance.now(), lastWheel + 180 - performance.now());
    if (remaining > 0) unlockTimer = setTimeout(waitForGestureEnd, remaining);
    else locked = false;
  }
  function turnPage(destination) {
    var from = pane.scrollTop;
    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var duration = reduceMotion ? 0 : 650;
    var started = performance.now();
    locked = true;
    lastWheel = started;
    lockedUntil = started + duration + 100;
    resetWheel();
    waitForGestureEnd();
    if (reduceMotion) {
      pane.scrollTop = destination;
      schedulePaint();
      return;
    }
    function step(now) {
      if (!homeDetails()) return cancelPaging();
      var t = Math.min(1, (now - started) / duration);
      var eased = t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      pane.scrollTop = from + (destination - from) * eased;
      schedulePaint();
      if (t < 1) animationFrame = requestAnimationFrame(step);
      else animationFrame = 0;
    }
    animationFrame = requestAnimationFrame(step);
  }
  function nestedScrollCanConsume(target, direction) {
    for (var node = target; node && node !== pane; node = node.parentElement) {
      if (!(node instanceof Element)) continue;
      if (node.matches('select, textarea, input, [contenteditable="true"]')) return true;
      var overflow = getComputedStyle(node).overflowY;
      if (/^(auto|scroll|overlay)$/.test(overflow) && node.scrollHeight > node.clientHeight + 1 &&
          (direction < 0 ? node.scrollTop > 0 : node.scrollTop + node.clientHeight < node.scrollHeight - 1)) return true;
    }
    return false;
  }
  function onWheel(event) {
    var details = homeDetails();
    if (!details || !window.matchMedia('(min-width: 861px)').matches || event.defaultPrevented ||
        event.ctrlKey || event.metaKey || event.altKey || event.shiftKey ||
        !event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    var direction = event.deltaY > 0 ? 1 : -1;
    if (nestedScrollCanConsume(event.target, direction)) return;
    if (locked) {
      event.preventDefault();
      lastWheel = performance.now();
      waitForGestureEnd();
      return;
    }
    var delta = Math.abs(event.deltaY) * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pane.clientHeight : 1);
    var boundary = detailsTop(details), top = pane.scrollTop;
    // If a short window cannot show the whole first scene, allow its hidden
    // content to scroll into view before paging to the second scene.
    var firstSceneEnd = Math.max(0, boundary - pane.clientHeight);
    var down = direction > 0 && top >= firstSceneEnd - 2 && top < boundary - 2;
    var up = direction < 0 && top >= boundary - 2 && top <= boundary + delta + 2;
    if (!down && !up) return resetWheel();
    event.preventDefault();
    if (wheelDirection !== direction) wheelDistance = 0;
    wheelDirection = direction;
    wheelDistance += delta;
    clearTimeout(resetTimer);
    resetTimer = setTimeout(resetWheel, 180);
    if (wheelDistance >= 24) turnPage(down ? boundary : 0);
  }

  pane.addEventListener('wheel', onWheel, { passive: false });
  pane.addEventListener('scroll', schedulePaint, { passive: true });
  pane.addEventListener('pointerdown', cancelPaging);
  pane.addEventListener('keydown', cancelPaging);
  window.addEventListener('resize', function () { cancelPaging(); schedulePaint(); });
  window.addEventListener('hashchange', function () { cancelPaging(); schedulePaint(); });
  var observer = new MutationObserver(function () {
    if (!homeDetails()) cancelPaging();
    schedulePaint();
  });
  observer.observe(app, { childList: true });
  observer.observe(document.body, { attributes: true, attributeFilter: ['data-view'] });
  observer.observe(root, { attributes: true, attributeFilter: ['data-appearance'] });
  schedulePaint();
}());
