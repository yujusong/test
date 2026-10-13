import datetime as dt
import io
import json
import os
from pathlib import Path
import re
import secrets
import signal
import subprocess
import sqlite3
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib import request, parse, error
import qrcode
from qrcode.image.svg import SvgPathImage

ROOT = Path(__file__).parent / 'public'
TTL = min(3600, max(1, int(os.environ.get('SESSION_SECONDS', '3600'))))
END = time.time() + TTL
if os.environ.get('SESSION_EXPIRES_AT'):
    END = min(END, dt.datetime.fromisoformat(os.environ['SESSION_EXPIRES_AT'].replace('Z', '+00:00')).timestamp())
    TTL = max(0, END - time.time())
DB = os.environ.get('DATA_PATH', '/data/votes.sqlite')
SB = os.environ.get('SUPABASE_URL', '').rstrip('/')
KEY = os.environ.get('SUPABASE_PUBLISHABLE_KEY', '')
SESSION = os.environ.get('SUPABASE_SESSION_ID', '')
CLOUD = bool(SB and KEY and SESSION)
SESSION_KEY = secrets.token_urlsafe(24)
KST = dt.timezone(dt.timedelta(hours=9))
RATE = {}
LOCK = threading.Lock()
PUBLIC_URL = ''

def connect():
    return sqlite3.connect(DB, timeout=5)

with connect() as db:
    db.execute('CREATE TABLE IF NOT EXISTS votes (id INTEGER PRIMARY KEY, team TEXT, menu TEXT, day TEXT, voter TEXT, UNIQUE(team, day, voter))')

def supabase(path, payload=None):
    data = None if payload is None else json.dumps(payload).encode()
    req = request.Request(SB + '/rest/v1/' + path, data=data, headers={
        'apikey': KEY, 'Authorization': 'Bearer ' + KEY,
        'Content-Type': 'application/json', 'Prefer': 'return=minimal',
    })
    with request.urlopen(req, timeout=8) as response:
        body = response.read()
        return json.loads(body) if body else None

class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Avoid logging browser identifiers or request bodies.
        print(f'{self.command} {parse.urlsplit(self.path).path}', flush=True)

    def send(self, status, payload, content_type='application/json; charset=utf-8'):
        body = json.dumps(payload, ensure_ascii=False).encode() if content_type.startswith('application/json') else payload
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
        self.end_headers()
        self.wfile.write(body)

    def active(self):
        if time.time() >= END:
            self.send(410, {'error': '실습 시간이 끝났습니다. 서비스가 종료되었습니다.'})
            return False
        return True

    def do_GET(self):
        if not self.active(): return
        url = parse.urlsplit(self.path)
        query = parse.parse_qs(url.query)
        if url.path == '/api/session':
            self.send(200, {'expiresAt': int(END * 1000), 'serverTime': int(time.time() * 1000), 'mode': 'supabase' if CLOUD else 'container', 'sessionKey': SESSION_KEY, 'publicUrl': PUBLIC_URL})
        elif url.path == '/api/top':
            team = query.get('team', ['우리팀'])[0].strip()[:24] or '우리팀'
            day = dt.datetime.now(KST).date().isoformat()
            try:
                if CLOUD:
                    rows = supabase('rpc/lunch_top', {'p_session': SESSION, 'p_team': team})
                else:
                    with connect() as db:
                        rows = [{'menu': m, 'count': c} for m, c in db.execute('SELECT menu, COUNT(*) AS n FROM votes WHERE team=? AND day=? GROUP BY menu ORDER BY n DESC, menu ASC LIMIT 5', (team, day))]
                self.send(200, {'rows': rows, 'team': team, 'day': day})
            except Exception:
                self.send(503, {'error': '순위를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'})
        elif url.path == '/api/qr':
            value = query.get('url', [''])[0]
            if len(value) > 1000 or not value.startswith(('https://', 'http://')):
                return self.send(400, {'error': '올바른 URL이 필요합니다.'})
            buffer = io.BytesIO()
            qrcode.make(value, image_factory=SvgPathImage, border=3).save(buffer)
            self.send(200, buffer.getvalue(), 'image/svg+xml')
        else:
            files = {'/': ('index.html', 'text/html; charset=utf-8'), '/style.css': ('style.css', 'text/css; charset=utf-8'), '/script.js': ('script.js', 'text/javascript; charset=utf-8')}
            if url.path not in files: return self.send(404, {'error': '페이지가 없습니다.'})
            name, mime = files[url.path]
            self.send(200, (ROOT / name).read_bytes(), mime)

    def do_POST(self):
        if not self.active(): return
        if self.path != '/api/vote': return self.send(404, {'error': '페이지가 없습니다.'})
        if self.headers.get('X-Lunch-Session') != SESSION_KEY:
            return self.send(403, {'error': '새로고침 후 다시 시도해 주세요.'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 2048: raise ValueError()
            body = json.loads(self.rfile.read(length))
            team, menu, voter = (body.get(k, '') for k in ('team', 'menu', 'voter'))
            if not all(isinstance(v, str) for v in (team, menu, voter)): raise ValueError()
            team, menu = team.strip(), menu.strip()
            if not 1 <= len(team) <= 24 or not 1 <= len(menu) <= 20 or not re.fullmatch(r'[a-zA-Z0-9-]{16,64}', voter): raise ValueError()
        except (ValueError, TypeError, json.JSONDecodeError):
            return self.send(400, {'error': '투표 내용을 확인해 주세요.'})
        with LOCK:
            now = time.monotonic()
            for ip in list(RATE):
                if now - RATE[ip] > 60: del RATE[ip]
            ip = self.client_address[0]
            if now - RATE.get(ip, -100) < 1: return self.send(429, {'error': '잠시 후 다시 시도해 주세요.'})
            RATE[ip] = now
        try:
            if CLOUD:
                supabase('rpc/lunch_vote', {'p_session': SESSION, 'p_team': team, 'p_menu': menu, 'p_voter': voter})
            else:
                with connect() as db:
                    db.execute('INSERT INTO votes(team,menu,day,voter) VALUES(?,?,?,?)', (team, menu, dt.datetime.now(KST).date().isoformat(), voter))
            self.send(201, {'ok': True})
        except sqlite3.IntegrityError:
            self.send(409, {'error': '이 팀에서 오늘 이미 투표했어요.'})
        except error.HTTPError as exc:
            self.send(409 if exc.code == 409 else 503, {'error': '이미 투표했거나 투표 시간이 종료되었습니다.'})
        except Exception:
            self.send(503, {'error': '투표를 저장하지 못했습니다. 다시 시도해 주세요.'})

server = ThreadingHTTPServer(('0.0.0.0', int(os.environ.get('PORT', 8080))), Handler)
tunnel = None
if os.environ.get('ENABLE_TUNNEL') == '1':
    tunnel = subprocess.Popen(['cloudflared', 'tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', 'http://127.0.0.1:8080'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    def relay_tunnel():
        global PUBLIC_URL
        for line in tunnel.stdout:
            match = re.search(r'https://[a-z0-9-]+\.trycloudflare\.com', line)
            if match: PUBLIC_URL = match.group(0)
            print(line.rstrip(), flush=True)
    threading.Thread(target=relay_tunnel, daemon=True).start()
expiry_stop = threading.Event()
def expiry_watchdog():
    while True:
        remaining = END - time.time()
        if remaining <= 0:
            server.shutdown()
            return
        if expiry_stop.wait(min(1, remaining)):
            return
threading.Thread(target=expiry_watchdog, daemon=True).start()
signal.signal(signal.SIGTERM, lambda *_: threading.Thread(target=server.shutdown, daemon=True).start())
print(f'Lunch roulette ready; expires {dt.datetime.fromtimestamp(END, KST).isoformat()}', flush=True)
try:
    server.serve_forever()
finally:
    expiry_stop.set()
    server.server_close()
    if tunnel:
        tunnel.terminate()
        try:
            tunnel.wait(timeout=5)
        except subprocess.TimeoutExpired:
            tunnel.kill()
