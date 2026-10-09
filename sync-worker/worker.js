const SITE_ORIGIN = 'https://makise-kurisu-d.github.io';
const SITE_HOME = `${SITE_ORIGIN}/kyle-dse-quiz/`;
const REPO = 'Makise-Kurisu-D/kyle-dse-quiz-data';
const DATA_PATH = 'records.json';

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

function encodeUtf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function decodeUtf8(value) {
  const binary = atob(value.replace(/\n/g, ''));
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function mergeBackup(current, incoming) {
  if (!current || current.app !== 'kyle-dse-quiz') return incoming;
  function mergeSessions(a, b) {
    const seen = new Set(), out = [];
    [...(a || []), ...(b || [])].forEach(session => {
      if (!session || typeof session.t !== 'number') return;
      const key = [session.t, session.subj, session.topic, JSON.stringify(session.results || {})].join('|');
      if (!seen.has(key)) { seen.add(key); out.push(session); }
    });
    return out.sort((a, b) => a.t - b.t);
  }
  const plans = { ...(current.reviewPlan || {}) };
  Object.entries(incoming.reviewPlan || {}).forEach(([id, p]) => {
    if (!plans[id] || (p.lastAt || 0) >= (plans[id].lastAt || 0)) plans[id] = p;
  });
  return {
    app: 'kyle-dse-quiz', version: 1, exportedAt: new Date().toISOString(),
    sessions: mergeSessions(current.sessions, incoming.sessions),
    archive: mergeSessions(current.archive, incoming.archive),
    drafts: { ...(current.drafts || {}), ...(incoming.drafts || {}) },
    reviewPlan: plans,
    cycle: String(Math.max(Number(current.cycle || 0), Number(incoming.cycle || 0))) || null,
  };
}

function cors(request, headers = {}) {
  const origin = request.headers.get('Origin');
  return {
    ...headers,
    'access-control-allow-origin': origin === SITE_ORIGIN ? SITE_ORIGIN : 'null',
    'access-control-allow-credentials': 'false',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, PUT, POST, DELETE, OPTIONS',
    'vary': 'Origin',
    'cache-control': 'no-store',
  };
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function randomId() {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

async function digest(value) {
  const data = new TextEncoder().encode(value);
  return base64url(await crypto.subtle.digest('SHA-256', data));
}

async function signedState(value, secret) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return `${value}.${base64url(mac)}`;
}

async function verifyState(signed, secret) {
  const dot = signed.lastIndexOf('.');
  if (dot < 1) return false;
  return (await signedState(signed.slice(0, dot), secret)) === signed;
}

async function seal(value, secret) {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key,
    new TextEncoder().encode(JSON.stringify(value)));
  return `${base64url(iv)}.${base64url(cipher)}`;
}

async function unseal(value, secret) {
  const [ivText, cipherText] = value.split('.');
  const decode = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(ivText) }, key, decode(cipherText));
  return JSON.parse(new TextDecoder().decode(plain));
}

async function github(path, token, init = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'kyle-dse-quiz-sync',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.message || `GitHub returned ${response.status}`), { status: response.status });
  return body;
}

async function tokenFor(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const match = auth.match(/^Bearer ([A-Za-z0-9_-]{40,80})$/);
  if (!match) return null;
  const sessionKey = await digest(match[1]);
  const saved = await env.SESSIONS.get(sessionKey);
  if (!saved) return null;
  let session = await unseal(saved, env.SESSION_SECRET);
  if (session.expiresAt && Date.now() > session.expiresAt - 60000) {
    if (!session.refreshToken) {
      await env.SESSIONS.delete(sessionKey);
      return null;
    }
    const refresh = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET,
        grant_type: 'refresh_token', refresh_token: session.refreshToken }),
    });
    const next = await refresh.json();
    if (!refresh.ok || !next.access_token) {
      await env.SESSIONS.delete(sessionKey);
      return null;
    }
    session = {
      accessToken: next.access_token,
      refreshToken: next.refresh_token,
      expiresAt: Date.now() + Number(next.expires_in || 28800) * 1000,
    };
    await env.SESSIONS.put(sessionKey, await seal(session, env.SESSION_SECRET), { expirationTtl: Math.max(3600, Number(next.refresh_token_expires_in || 15897600)) });
  }
  return { token: session.accessToken, sessionKey };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request) });
    if (url.pathname === '/auth/start' && request.method === 'GET') {
      const state = await randomId();
      const signed = await signedState(state, env.SESSION_SECRET);
      const cookie = `dse_oauth_state=${signed}; HttpOnly; Secure; SameSite=Lax; Path=/auth/callback; Max-Age=600`;
      const authorize = new URL('https://github.com/login/oauth/authorize');
      authorize.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
      authorize.searchParams.set('redirect_uri', `${url.origin}/auth/callback`);
      authorize.searchParams.set('state', state);
      authorize.searchParams.set('allow_signup', 'false');
      const response = new Response(null, { status: 302, headers: { location: authorize.toString() } });
      response.headers.append('set-cookie', cookie);
      return response;
    }
    if (url.pathname === '/auth/callback' && request.method === 'GET') {
      const state = url.searchParams.get('state') || '';
      const cookie = request.headers.get('Cookie') || '';
      const saved = (cookie.match(/(?:^|; )dse_oauth_state=([^;]+)/) || [])[1] || '';
      if (!state || state !== saved.split('.')[0] || !(await verifyState(saved, env.SESSION_SECRET))) {
        return new Response('OAuth state check failed. Return to the quiz site and reconnect.', { status: 400 });
      }
      if (url.searchParams.has('error')) return Response.redirect(`${SITE_HOME}?v=${Date.now()}#/records?sync=cancelled`, 302);
      const exchange = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET,
          code: url.searchParams.get('code'), redirect_uri: `${url.origin}/auth/callback`, state }),
      });
      const token = await exchange.json();
      if (!exchange.ok || !token.access_token) return new Response('GitHub authorization failed.', { status: 502 });
      const sessionId = await randomId();
      const sessionKey = await digest(sessionId);
      const session = {
        accessToken: token.access_token,
        refreshToken: token.refresh_token || null,
        expiresAt: token.expires_in ? Date.now() + Number(token.expires_in) * 1000 : 0,
      };
      await env.SESSIONS.put(sessionKey, await seal(session, env.SESSION_SECRET), {
        expirationTtl: Math.max(3600, Number(token.refresh_token_expires_in || 15897600)),
      });
      const handoff = await randomId();
      await env.SESSIONS.put(`handoff:${await digest(handoff)}`, sessionId, { expirationTtl: 120, metadata: { oneTime: true } });
      const headers = new Headers({ location: `${SITE_HOME}?v=${Date.now()}#/records?sync=connected&handoff=${encodeURIComponent(handoff)}` });
      headers.append('set-cookie', 'dse_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/auth/callback; Max-Age=0');
      return new Response(null, { status: 302, headers });
    }
    if (url.pathname === '/auth/exchange' && request.method === 'POST') {
      if (request.headers.get('Origin') !== SITE_ORIGIN) return json({ error: 'origin_denied' }, 403, cors(request));
      const body = await request.json().catch(() => ({}));
      const handoffKey = `handoff:${await digest(String(body.handoff || ''))}`;
      const sessionId = await env.SESSIONS.get(handoffKey);
      if (!sessionId) return json({ error: 'handoff_expired' }, 410, cors(request));
      await env.SESSIONS.delete(handoffKey);
      return json({ sessionId }, 200, cors(request));
    }
    if (url.pathname === '/sync' && ['GET', 'PUT', 'DELETE'].includes(request.method)) {
      if (request.headers.get('Origin') !== SITE_ORIGIN) return json({ error: 'origin_denied' }, 403, cors(request));
      const auth = await tokenFor(request, env);
      if (!auth) return json({ error: 'not_connected' }, 401, cors(request));
      const path = `/repos/${REPO}/contents/${DATA_PATH}`;
      try {
        if (request.method === 'GET') {
          try {
            const file = await github(path, auth.token);
            const data = JSON.parse(decodeUtf8(file.content));
            return json({ data, sha: file.sha }, 200, cors(request));
          } catch (error) {
            if (error.status === 404) return json({ data: null, sha: null }, 200, cors(request));
            throw error;
          }
        }
        if (request.method === 'DELETE') {
          const current = await github(path, auth.token).catch(error => error.status === 404 ? null : Promise.reject(error));
          if (!current) return json({ ok: true, deleted: false }, 200, cors(request));
          await github(path, auth.token, { method: 'DELETE', body: JSON.stringify({ message: 'Clear synced practice records', sha: current.sha }) });
          return json({ ok: true, deleted: true }, 200, cors(request));
        }
        const body = await request.json();
        if (!body.data || body.data.app !== 'kyle-dse-quiz') return json({ error: 'invalid_backup' }, 400, cors(request));
        let saved = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          const current = await github(path, auth.token).catch(error => error.status === 404 ? null : Promise.reject(error));
          const merged = current
            ? mergeBackup(JSON.parse(decodeUtf8(current.content)), body.data)
            : body.data;
          const payload = { message: 'Sync practice records', content: encodeUtf8(JSON.stringify(merged, null, 2)) };
          if (current) payload.sha = current.sha;
          try {
            saved = await github(path, auth.token, { method: 'PUT', body: JSON.stringify(payload) });
            break;
          } catch (error) {
            if (error.status !== 409 || attempt === 2) throw error;
          }
        }
        return json({ ok: true, sha: saved && saved.content && saved.content.sha, savedAt: new Date().toISOString() }, 200, cors(request));
      } catch (error) {
        if (error.status === 401) await env.SESSIONS.delete(auth.sessionKey);
        return json({ error: error.message || 'github_error', status: error.status || 500 }, error.status || 500, cors(request));
      }
    }
    if (url.pathname === '/health') return json({ ok: true, service: 'kyle-dse-quiz-sync' });
    return json({ error: 'not_found' }, 404);
  },
};

