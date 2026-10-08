import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import worker from './worker.js';

const ORIGIN = 'https://makise-kurisu-d.github.io';
const BASE = 'https://sync.example.workers.dev';
const SECRET = 'test-only-session-secret-with-enough-entropy';

class MemoryKV {
  constructor() { this.values = new Map(); }
  async get(key) { return this.values.get(key) ?? null; }
  async put(key, value) { this.values.set(key, value); }
  async delete(key) { this.values.delete(key); }
}

function b64json(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function fromB64json(value) {
  const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

test('health and CORS preflight are available locally', async () => {
  const env = { SESSIONS: new MemoryKV(), SESSION_SECRET: SECRET, GITHUB_CLIENT_ID: 'test-client' };
  const health = await worker.fetch(new Request(`${BASE}/health`), env);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).service, 'kyle-dse-quiz-sync');

  const preflight = await worker.fetch(new Request(`${BASE}/sync`, {
    method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'PUT' },
  }), env);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), ORIGIN);
});

test('the Worker responds through a local HTTP service', async t => {
  const env = { SESSIONS: new MemoryKV(), SESSION_SECRET: SECRET, GITHUB_CLIENT_ID: 'test-client' };
  const server = createServer(async (req, res) => {
    const headers = new Headers();
    Object.entries(req.headers).forEach(([key, value]) => {
      if (Array.isArray(value)) value.forEach(item => headers.append(key, item));
      else if (value != null) headers.set(key, value);
    });
    const response = await worker.fetch(new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers }), env);
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    res.end(await response.text());
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: 'kyle-dse-quiz-sync' });
});

test('OAuth handoff authenticates and sync merges through GitHub contents API', async t => {
  const env = {
    SESSIONS: new MemoryKV(), SESSION_SECRET: SECRET,
    GITHUB_CLIENT_ID: 'test-client', GITHUB_CLIENT_SECRET: 'test-secret',
  };
  const originalFetch = globalThis.fetch;
  const empty = { app: 'kyle-dse-quiz', version: 1, sessions: [], archive: [], drafts: {}, reviewPlan: {}, cycle: null };
  let file = { content: b64json(empty), sha: 'sha-1' };
  let putAttempts = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === 'https://github.com/login/oauth/access_token') {
      return Response.json({ access_token: 'mock-access-token-which-is-long-enough-for-validation',
        refresh_token: 'mock-refresh-token', expires_in: 28800, refresh_token_expires_in: 15897600 });
    }
    if (url.endsWith('/contents/records.json') && (!init.method || init.method === 'GET')) {
      return Response.json(file);
    }
    if (url.endsWith('/contents/records.json') && init.method === 'PUT') {
      putAttempts++;
      if (putAttempts === 1) return Response.json({ message: 'sha conflict' }, { status: 409 });
      const payload = JSON.parse(init.body);
      assert.equal(payload.sha, file.sha);
      file = { content: payload.content, sha: `sha-${putAttempts}` };
      return Response.json({ content: { sha: file.sha } });
    }
    throw new Error(`Unexpected mock request: ${url}`);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const start = await worker.fetch(new Request(`${BASE}/auth/start`), env);
  assert.equal(start.status, 302);
  const cookie = start.headers.get('set-cookie').split(';')[0];
  const authorization = new URL(start.headers.get('location'));
  const state = authorization.searchParams.get('state');
  const callback = await worker.fetch(new Request(`${BASE}/auth/callback?code=mock-code&state=${state}`, {
    headers: { Cookie: cookie },
  }), env);
  assert.equal(callback.status, 302);
  const redirect = new URL(callback.headers.get('location'));
  const handoff = new URLSearchParams(redirect.hash.split('?')[1]).get('handoff');
  assert.ok(handoff);

  const exchange = await worker.fetch(new Request(`${BASE}/auth/exchange`, {
    method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ handoff }),
  }), env);
  assert.equal(exchange.status, 200);
  const sessionId = (await exchange.json()).sessionId;
  assert.ok(sessionId);

  const unauthorized = await worker.fetch(new Request(`${BASE}/sync`, { headers: { Origin: ORIGIN } }), env);
  assert.equal(unauthorized.status, 401);
  const deniedOrigin = await worker.fetch(new Request(`${BASE}/sync`, {
    headers: { Origin: 'https://attacker.example', Authorization: `Bearer ${sessionId}` },
  }), env);
  assert.equal(deniedOrigin.status, 403);

  const backup = { ...empty, sessions: [{ t: 1, subj: 'chem', topic: 'T1', results: { q1: { marks: 1, tot: 1 } } }] };
  const saved = await worker.fetch(new Request(`${BASE}/sync`, {
    method: 'PUT', headers: { Origin: ORIGIN, Authorization: `Bearer ${sessionId}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: backup }),
  }), env);
  assert.equal(saved.status, 200);
  assert.equal(putAttempts, 2, 'a concurrent GitHub SHA conflict is retried');
  assert.equal(fromB64json(file.content).sessions.length, 1);
  assert.equal(saved.headers.get('access-control-allow-origin'), ORIGIN);
});

