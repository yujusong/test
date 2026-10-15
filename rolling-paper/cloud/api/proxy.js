// Vercel gateway for the rolling paper. The live service is owned by the Docker
// container: this function only forwards requests to the container's tunnel
// origin, which it looks up from Supabase (rp_live). When the container stops or
// its one-hour session ends, nothing is served from here.
const ORIGIN_RE = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/;
const STATIC = new Set(['/', '/m', '/m/', '/app.js', '/style.css', '/favicon.svg', '/vendor/supabase.js']);
const GET_API = new Set(['/api/session', '/api/board', '/api/pulse', '/api/photo', '/api/export', '/api/qr']);
const POST_API = new Set(['/api/boards', '/api/notes', '/api/heart', '/api/delete', '/api/deadline']);
const FORWARD_REQ = ['content-type', 'user-agent', 'sec-ch-ua-mobile', 'accept', 'x-rp-key', 'x-rp-voter', 'x-rp-admin'];
const FORWARD_RES = ['content-type', 'cache-control', 'content-disposition', 'content-security-policy',
  'referrer-policy', 'permissions-policy', 'vary', 'x-content-type-options'];
let live = { value: null, at: 0 };

async function liveOrigin(force) {
  if (!force && Date.now() - live.at < 15000) return live.value;
  const url = (process.env.RP_SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.RP_SUPABASE_KEY || '';
  if (!url || !key) return null;
  const res = await fetch(`${url}/rest/v1/rpc/rp_live`, {
    method: 'POST', body: '{}', signal: AbortSignal.timeout(5000),
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error('lookup failed');
  const data = await res.json();
  const value = data && ORIGIN_RE.test(data.origin || '') && Date.parse(data.expiresAt) > Date.now() ? data : null;
  live = { value, at: Date.now() };
  return value;
}

function page(res, status, emoji, title, text) {
  res.status(status).setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
  res.send(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>우리 팀 롤링페이퍼</title><style>
:root{color-scheme:light dark;--bg:#f7f0e4;--ink:#2e2721;--muted:#7b6d5f}
@media (prefers-color-scheme:dark){:root{--bg:#1b1713;--ink:#f1e8dc;--muted:#b5a690}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:16px/1.6 -apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;padding:16px;text-align:center}
main{max-width:460px}p.e{font-size:56px;margin:0}h1{font-size:24px;margin:8px 0}p{color:var(--muted)}</style></head>
<body><main><p class="e">${emoji}</p><h1>${title}</h1><p>${text}</p></main></body></html>`);
}

function fail(req, res, path, status, emoji, title, text) {
  if (path.startsWith('/api/')) return res.status(status).json({ error: text });
  return page(res, status, emoji, title, text);
}

function readBody(req) {
  if (req.body === undefined || req.body === null) return undefined;
  if (Buffer.isBuffer(req.body) || typeof req.body === 'string') return req.body;
  return JSON.stringify(req.body);
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const path = '/' + String(req.query.path || '').replace(/^\/+/, '');
  const method = req.method === 'HEAD' ? 'GET' : req.method;
  const allowed = method === 'GET' ? STATIC.has(path) || GET_API.has(path) : method === 'POST' && POST_API.has(path);
  if (!allowed) return fail(req, res, path, 404, '🧭', '페이지가 없어요', '주소를 다시 확인해 주세요.');

  let target;
  try {
    target = await liveOrigin(false);
  } catch {
    return fail(req, res, path, 503, '🌙', '서비스에 연결할 수 없어요', '잠시 후 다시 시도해 주세요.');
  }
  if (!target) {
    return fail(req, res, path, 410, '🌙', '실습 시간이 끝났어요',
      '롤링페이퍼 서비스는 Docker 컨테이너가 켜져 있는 1시간 동안만 열려요. 지금은 닫혀 있어요.');
  }

  const url = new URL(path, target.origin);
  for (const [k, v] of Object.entries(req.query)) if (k !== 'path') url.searchParams.set(k, String(v));
  const headers = {};
  for (const h of FORWARD_REQ) if (req.headers[h]) headers[h] = String(req.headers[h]);
  try {
    const upstream = await fetch(url, {
      method, headers, redirect: 'manual', signal: AbortSignal.timeout(20000),
      body: method === 'POST' ? readBody(req) : undefined,
    });
    if ([502, 503, 504, 530].includes(upstream.status) && !upstream.headers.get('content-type')?.includes('json')) {
      throw new Error('tunnel down');
    }
    for (const h of FORWARD_RES) if (upstream.headers.has(h)) res.setHeader(h, upstream.headers.get(h));
    const location = upstream.headers.get('location');
    if (location && location.startsWith('/') && !location.startsWith('//')) res.setHeader('Location', location);
    res.status(upstream.status);
    return res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    live.at = 0; // the container may have restarted with a new origin
    return fail(req, res, path, 503, '🔌', '서비스가 꺼져 있어요',
      '실습용 Docker 컨테이너가 종료되어 지금은 연결할 수 없어요.');
  }
};
