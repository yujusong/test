// Vercel gateway: the live service remains owned by the Docker container.
// Set LUNCH_ORIGIN to its HTTPS origin. No static fallback is deployed here.
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const origin = process.env.LUNCH_ORIGIN;
  const until = Date.parse(process.env.LUNCH_EXPIRES_AT || '');
  if (!origin || !Number.isFinite(until) || Date.now() >= until) {
    return res.status(410).json({error:'실습 세션이 종료되었거나 아직 시작되지 않았습니다.'});
  }
  const path = '/' + String(req.query.path || '');
  const allowed = ['/', '/style.css', '/script.js', '/api/session', '/api/top', '/api/vote', '/api/qr'];
  if (!allowed.includes(path) || !['GET','POST'].includes(req.method) || (req.method === 'POST' && path !== '/api/vote')) {
    return res.status(404).json({error:'페이지가 없습니다.'});
  }
  try {
    const base = new URL(origin);
    if (base.protocol !== 'https:' || base.username || base.password) throw new Error('Invalid origin');
    const url = new URL(path, base);
    for (const [key, value] of Object.entries(req.query)) {
      if (key !== 'path') url.searchParams.set(key, String(value));
    }
    const headers = {'Content-Type':'application/json'};
    if (req.headers['x-lunch-session']) headers['X-Lunch-Session'] = req.headers['x-lunch-session'];
    const upstream = await fetch(url, {
      method:req.method, headers, redirect:'error', signal:AbortSignal.timeout(8000),
      body:req.method === 'POST' ? JSON.stringify(req.body) : undefined,
    });
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
    for (const key of ['Content-Security-Policy','Referrer-Policy']) {
      if (upstream.headers.has(key)) res.setHeader(key,upstream.headers.get(key));
    }
    return res.status(upstream.status).send(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    return res.status(503).json({error:'실행 컨테이너가 종료되었거나 연결할 수 없습니다.'});
  }
};
