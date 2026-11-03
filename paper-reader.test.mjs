import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

// Geometry and page blobs are synthetic. These checks never read private papers.
function boot(overrides = {}) {
  const events = {}, frames = [], timers = [], urls = [], revoked = [], positions = [], jumps = [], loads = [];
  let serial = 0, width = 700;
  const doc = { activeElement: null }, nodes = new Map();
  function node(name, rect = null) {
    if (nodes.has(name)) return nodes.get(name);
    const children = new Map(), handlers = {};
    const value = {
      name, handlers, children, hidden: false, isConnected: true, scrollTop: 0, scrollLeft: 0,
      style: { setProperty() {} }, clientWidth: 360, clientHeight: 500, className: '',
      getBoundingClientRect: rect || (() => ({ top: 0, bottom: 40, height: 40, width: 360 })),
      addEventListener(type, fn) { handlers[type] = fn; },
      removeEventListener(type, fn) { if (handlers[type] === fn) delete handlers[type]; },
      setAttribute(key, v) { this[key] = v; },
      removeAttribute(key) { delete this[key]; },
      appendChild(child) { children.set(child.name, child); },
      remove() { this.isConnected = false; },
      focus() { doc.activeElement = this; },
      querySelector(selector) {
        if (children.has(selector)) return children.get(selector);
        const child = node(name + ' ' + selector); children.set(selector, child); return child;
      },
      querySelectorAll() { return Array.from(children.values()); },
      get src() { return this._src; },
      set src(v) { this._src = v; if (this.onload) this.onload(); },
    };
    if (name.includes('paper-zoom-image')) {
      Object.defineProperty(value, 'clientWidth', { get() { return parseFloat(value.style.width) || 360; } });
      Object.defineProperty(value, 'clientHeight', { get() { return value.clientWidth * 1.4; } });
    }
    nodes.set(name, value); return value;
  }
  const scroll = node('scroll', () => ({ top: 100, bottom: 700, height: 600 }));
  scroll.clientHeight = 600;
  Object.defineProperty(scroll, 'scrollHeight', { get() { return 200 + 3 * 1020 * width / 700; } });
  const root = node('root', () => ({ top: 200 - scroll.scrollTop, height: 3 * 1020 * width / 700 }));
  Object.defineProperty(root, 'clientWidth', { get() { return width; } });
  Object.defineProperty(root, 'scrollHeight', { get() { return 3 * 1020 * width / 700; } });
  root.querySelector = selector => {
    const match = selector.match(/^#paperSheet-(\d+)$/);
    if (!match) return node(selector);
    const n = Number(match[1]);
    const sheet = node(selector, () => ({ top: 200 + (n - 1) * 1020 * width / 700 - scroll.scrollTop, height: 1000 * width / 700 }));
    sheet.querySelector = () => node(selector + ' body', () => ({ top: sheet.getBoundingClientRect().top + 30, height: 970 * width / 700 }));
    return sheet;
  };
  const thumbs = node('thumbs', () => ({ top: 160, bottom: 460, height: 300 }));
  const toolbar = node('toolbar', () => ({ top: 100, bottom: 150, height: 50 }));
  toolbar.parentElement = node('toolbar-parent');
  const trigger = doc.activeElement = node('trigger');
  const body = doc.body = node('document-body');
  doc.createElement = tag => {
    const value = node('created-' + tag + '-' + (++serial));
    if (tag === 'dialog') { value.showModal = () => { value.open = true; }; value.close = () => { value.open = false; }; }
    return value;
  };
  const context = {
    window: {}, document: doc, console, Blob,
    URL: { createObjectURL() { const url = 'blob:synthetic-' + urls.length; urls.push(url); return url; }, revokeObjectURL(url) { revoked.push(url); } },
    setTimeout(fn, delay) { timers.push({ fn, delay }); return timers.length; }, clearTimeout() {},
  };
  Object.assign(context.window, {
    addEventListener(type, fn) { events[type] = fn; }, removeEventListener(type, fn) { if (events[type] === fn) delete events[type]; },
    requestAnimationFrame(fn) { frames.push(fn); return frames.length; }, cancelAnimationFrame() {},
  });
  vm.createContext(context);
  vm.runInContext(readFileSync(new URL('./paper-reader.js', import.meta.url), 'utf8'), context);
  const reader = context.window.DSEPaperReader({
    root, scrollRoot: scroll, thumbs, toolbar, title: '合成試卷',
    manifest: { pages: 3, version: 'a'.repeat(16), mistakes: [
      { page: 1, x: .2, y: .5, label: 'Q1(b)', question_id: 'q-1' },
      { page: 2, x: .6, y: .3, label: 'Q2', question_id: 'q-2' },
      { page: 9, x: .5, y: .2, label: 'invalid' },
    ] },
    onPage() {}, onError(error) { throw error; },
    onPosition(position) { positions.push(position); }, onMistake(target) { jumps.push(target); },
    loadPage(page) { loads.push(page); return Promise.resolve(new Blob(['synthetic-page-' + page])); },
    ...overrides,
  });
  return { reader, scroll, root, nodes, timers, frames, events, positions, jumps, loads, urls, revoked, doc, trigger,
    resize(nextWidth) { width = nextWidth; },
    flush() { const batch = frames.splice(0); batch.forEach(fn => fn()); },
    dialog() { return Array.from(body.children.values()).find(value => value.isConnected); },
  };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('restored page fractions survive resizing and report only normalized reading metadata', () => {
  const app = boot({ initialPosition: { page: 2, fraction: .4, mistakeLabel: 'Q2' } });
  let position = app.reader.getPosition();
  assert.equal(position.page, 2); assert.ok(Math.abs(position.fraction - .4) < 1e-9);
  assert.equal(position.mistakeLabel, 'Q2');
  assert.equal(app.jumps[0].question_id, 'q-2');
  app.reader.layoutChange(() => app.resize(1050)); app.flush();
  position = app.reader.getPosition();
  assert.equal(position.page, 2); assert.ok(Math.abs(position.fraction - .4) < 1e-9);
  assert.ok(app.positions.every(value => value.page >= 1 && value.page <= 3 && value.fraction >= 0 && value.fraction < 1));
  app.reader.destroy();
});

test('mistake jumps preserve stable question IDs and wrap without losing explicit selections', () => {
  const app = boot();
  const first = app.reader.goMistake(1);
  assert.equal(first.question_id, 'q-1'); assert.equal(first.x, .2); assert.equal(first.index, 1); assert.equal(first.total, 2);
  const second = app.reader.nextMistake();
  assert.equal(second.question_id, 'q-2'); assert.equal(second.index, 2);
  const wrapped = app.reader.nextMistake();
  assert.equal(wrapped.question_id, 'q-1'); assert.equal(wrapped.wrapped, true);
  assert.equal(app.reader.getPosition().mistakeLabel, 'Q1(b)');
  assert.equal(app.reader.goMistake({ page: 2, label: 'Q2', question_id: 'different' }), null);
  assert.equal(app.reader.goMistake(0), null);
  app.reader.go(3); assert.equal(app.reader.getPosition().mistakeLabel, undefined);
  app.reader.destroy();
});

test('in-page zoom reuses readable page images, keeps the reading anchor and restores focus', async () => {
  const app = boot({ initialPosition: { page: 2, fraction: .25 } });
  await settle();
  const requests = app.loads.length;
  assert.equal(app.reader.openZoom(), true);
  const dialog = app.dialog(), image = dialog.querySelector('.paper-zoom-image');
  assert.equal(dialog.open, true); assert.equal(app.loads.length, requests);
  assert.equal(image.hidden, false);
  assert.equal(parseFloat(image.style.width), 672);
  dialog.querySelector('[data-zoom="fit"]').handlers.click();
  assert.equal(parseFloat(image.style.width), 336);
  dialog.querySelector('[data-zoom="in"]').handlers.click();
  assert.equal(parseFloat(image.style.width), 504);
  dialog.handlers.cancel({ preventDefault() {} });
  assert.equal(dialog.isConnected, false); assert.equal(app.doc.activeElement, app.trigger);
  assert.equal(app.reader.getPosition().page, 2);
  assert.ok(Math.abs(app.reader.getPosition().fraction - .25) < 1e-9);
  assert.equal(app.revoked.length, 0, 'closing a reused image does not revoke the reader-owned URL');
  app.reader.destroy();
  assert.ok(app.revoked.length > 0);
});

test('zoom closes safely while its private image is pending and ignores late responses', async () => {
  const pending = [];
  const app = boot({ loadPage(page) { return new Promise(resolve => pending.push({ page, resolve })); } });
  app.reader.openZoom(3); await settle();
  assert.ok(pending.some(request => request.page === 3));
  app.reader.closeZoom();
  pending.find(request => request.page === 3).resolve(new Blob(['late-synthetic-page'])); await settle();
  assert.equal(app.urls.length, 0);
  app.reader.destroy();
  for (const request of pending) request.resolve(new Blob(['late-synthetic-page']));
  await settle(); assert.equal(app.urls.length, 0);
});

test('a zoom-only page URL is released on close while normal reader images remain usable', async () => {
  const app = boot(); await settle();
  const readerImage = app.nodes.get('#paperImage-1').src;
  app.reader.openZoom(3); await settle();
  const zoomImage = app.dialog().querySelector('.paper-zoom-image').src;
  assert.notEqual(zoomImage, readerImage);
  app.reader.closeZoom();
  assert.ok(app.revoked.includes(zoomImage));
  assert.ok(!app.revoked.includes(readerImage));
  app.reader.destroy(); assert.ok(app.revoked.includes(readerImage));
});
