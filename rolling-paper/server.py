import csv
import datetime as dt
import hashlib
import io
import json
import os
import re
import secrets
import signal
import subprocess
import threading
import time
from collections import OrderedDict, deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib import parse

import qrcode
from qrcode.image.svg import SvgPathImage

from stores import ApiError, decode_photo, make_store, now

ROOT = Path(__file__).parent / 'public'
TTL = min(3600, max(1, int(os.environ.get('SESSION_SECONDS', '3600'))))
STORE = make_store()
START = time.time()
END = START + TTL
if STORE.mode == 'supabase':
    END = min(END, STORE.start(TTL))
SESSION_KEY = secrets.token_urlsafe(24)
PUBLIC_URL = ''
LOCK = threading.Lock()
HITS = {}

STATIC = {
    '/': ('index.html', 'text/html; charset=utf-8'),
    '/m/': ('index.html', 'text/html; charset=utf-8'),
    '/app.js': ('app.js', 'text/javascript; charset=utf-8'),
    '/style.css': ('style.css', 'text/css; charset=utf-8'),
    '/favicon.svg': ('favicon.svg', 'image/svg+xml'),
    '/vendor/supabase.js': ('vendor/supabase.js', 'text/javascript; charset=utf-8'),
}
THEMES = ('birthday', 'farewell', 'welcome', 'graduation', 'thanks', 'feedback')
COLORS = ('yellow', 'pink', 'mint', 'blue')
STICKERS = ('', 'cake', 'party', 'heart', 'star', 'flower', 'clap', 'fire', 'coffee')
FONTS = ('pen', 'round', 'print')
MOBILE = re.compile(r'Android|iPhone|iPod|Mobile|IEMobile|Opera Mini|webOS|BlackBerry', re.I)
CODE = re.compile(r'[a-z0-9]{8}')
VOTER = re.compile(r'[A-Za-z0-9_-]{16,64}')


def sha(value):
    return hashlib.sha256(value.encode()).hexdigest()


def limited(bucket, limit, window):
    """Sliding-window limiter. Returns True when the caller must wait."""
    with LOCK:
        t = time.monotonic()
        hits = HITS.setdefault(bucket, deque())
        while hits and t - hits[0] > window:
            hits.popleft()
        if len(hits) >= limit:
            return True
        hits.append(t)
        if len(HITS) > 5000:
            for key in [k for k, v in HITS.items() if not v or t - v[-1] > 120]:
                del HITS[key]
        return False


class PhotoCache:
    """Small LRU so repeated views do not spend Supabase egress."""
    def __init__(self, limit=24 * 1024 * 1024):
        self.items, self.size, self.limit, self.lock = OrderedDict(), 0, limit, threading.Lock()

    def get(self, key):
        with self.lock:
            if key in self.items:
                self.items.move_to_end(key)
                return self.items[key]

    def put(self, key, data):
        with self.lock:
            if key in self.items:
                return
            self.items[key] = data
            self.size += len(data)
            while self.size > self.limit:
                _, old = self.items.popitem(last=False)
                self.size -= len(old)


PHOTOS = PhotoCache()


def text(value, low, high, field):
    if not isinstance(value, str):
        raise ApiError(400, f'{field}을(를) 확인해 주세요.')
    value = re.sub(r'[\x00-\x08\x0b-\x1f\x7f]', '', value).strip()
    if not low <= len(value) <= high:
        raise ApiError(400, f'{field}은(는) {low}~{high}자로 써 주세요.')
    return value


def parse_deadline(value):
    try:
        deadline = dt.datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        raise ApiError(400, '마감 시간을 확인해 주세요.') from None
    if deadline.tzinfo is None:
        raise ApiError(400, '마감 시간을 확인해 주세요.')
    return deadline


def csv_cell(value):
    value = '' if value is None else str(value)
    return "'" + value if value[:1] in ('=', '+', '-', '@', '\t', '\r') else value


class Handler(BaseHTTPRequestHandler):
    server_version = 'RollingPaper'
    sys_version = ''

    def log_message(self, format, *args):
        # Paths only: no voter ids, bodies or query strings in logs.
        print(f'{self.command} {parse.urlsplit(self.path).path} {args[1] if len(args) > 1 else ""}', flush=True)

    def headers_common(self, cache='no-store'):
        self.send_header('Cache-Control', cache)
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()')
        sb = os.environ.get('SUPABASE_URL', '').rstrip('/') if STORE.mode == 'supabase' else ''
        realtime = f' {sb} {sb.replace("https://", "wss://")}' if sb else ''
        self.send_header('Content-Security-Policy',
                         "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
                         "font-src https://fonts.gstatic.com; img-src 'self' data: blob:; "
                         f"connect-src 'self'{realtime}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'")

    def send(self, status, payload, content_type='application/json; charset=utf-8', cache='no-store', extra=None):
        body = json.dumps(payload, ensure_ascii=False).encode() if content_type.startswith('application/json') else payload
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.headers_common(cache)
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def redirect(self, location):
        self.send_response(302)
        self.send_header('Location', location)
        self.send_header('Content-Length', '0')
        self.send_header('Vary', 'User-Agent, Sec-CH-UA-Mobile')
        self.headers_common()
        self.end_headers()

    def active(self):
        if time.time() >= END:
            self.send(410, {'error': '실습 시간이 끝나 서비스가 닫혔어요.'})
            return False
        return True

    def viewer(self):
        voter = self.headers.get('X-RP-Voter', '')
        if not VOTER.fullmatch(voter):
            raise ApiError(400, '새로고침 후 다시 시도해 주세요.')
        return voter, sha(voter)

    def admin(self):
        key = self.headers.get('X-RP-Admin', '')
        return sha(key) if 16 <= len(key) <= 64 else ''

    def code(self, value):
        value = str(value or '').strip().lower()
        if not CODE.fullmatch(value):
            raise ApiError(404, '롤링페이퍼를 찾을 수 없어요. 링크를 확인해 주세요.')
        return value

    def handle_api(self, fn):
        try:
            fn()
        except ApiError as exc:
            self.send(exc.status, {'error': exc.message})
        except Exception as exc:  # noqa: BLE001
            print('error', type(exc).__name__, flush=True)
            self.send(500, {'error': '잠시 문제가 생겼어요. 다시 시도해 주세요.'})

    # GET ----------------------------------------------------------------------
    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        if not self.active():
            return
        url = parse.urlsplit(self.path)
        query = {k: v[0] for k, v in parse.parse_qs(url.query).items()}
        path = url.path
        if path == '/':
            mobile = MOBILE.search(self.headers.get('User-Agent', '')) or self.headers.get('Sec-CH-UA-Mobile') == '?1'
            if mobile and query.get('view') != 'desktop':
                return self.redirect('/m/' + (f'?{url.query}' if url.query else ''))
        if path == '/m':
            return self.redirect('/m/' + (f'?{url.query}' if url.query else ''))
        if path in STATIC:
            name, mime = STATIC[path]
            file = ROOT / name
            if not file.exists():
                return self.send(404, {'error': '페이지가 없어요.'})
            cache = 'no-cache' if path in ('/', '/m/') else 'public, max-age=300'
            return self.send(200, file.read_bytes(), mime, cache, {'Vary': 'User-Agent, Sec-CH-UA-Mobile'} if path == '/' else None)
        routes = {'/api/session': self.get_session, '/api/board': lambda: self.get_board(query),
                  '/api/pulse': lambda: self.get_pulse(query), '/api/photo': lambda: self.get_photo(query),
                  '/api/export': lambda: self.get_export(query), '/api/qr': lambda: self.get_qr(query)}
        if path in routes:
            return self.handle_api(routes[path])
        self.send(404, {'error': '페이지가 없어요.'})

    def get_session(self):
        realtime = None
        if STORE.mode == 'supabase':
            realtime = {'url': os.environ['SUPABASE_URL'].rstrip('/'), 'key': os.environ['SUPABASE_PUBLISHABLE_KEY']}
        self.send(200, {'mode': STORE.mode, 'expiresAt': int(END * 1000), 'serverTime': int(time.time() * 1000),
                        'key': SESSION_KEY, 'realtime': realtime, 'publicUrl': PUBLIC_URL})

    def get_board(self, query):
        _, viewer = self.viewer()
        self.send(200, STORE.get_board(self.code(query.get('b')), viewer))

    def get_pulse(self, query):
        self.send(200, {'board': STORE.pulse(self.code(query.get('b'))), 'expiresAt': int(END * 1000),
                        'serverTime': int(time.time() * 1000)})

    def get_photo(self, query):
        _, viewer = self.viewer()
        code = self.code(query.get('b'))
        try:
            note_id = int(query.get('id', ''))
        except ValueError:
            raise ApiError(404, '사진이 없어요.') from None
        path = STORE.photo_path(code, note_id, viewer)
        data = PHOTOS.get(path)
        if data is None:
            data = STORE.read_photo(path)
            PHOTOS.put(path, data)
        self.send(200, data, 'image/jpeg', 'private, max-age=3600')

    def get_export(self, query):
        code = self.code(query.get('b'))
        title, rows = STORE.export(code, self.admin())
        out = io.StringIO()
        writer = csv.writer(out)
        writer.writerow(['번호', '작성자', '메시지', '색', '스티커', '사진', '하트', '작성 시각(KST)'])
        kst = dt.timezone(dt.timedelta(hours=9))
        for r in rows:
            when = dt.datetime.fromisoformat(str(r['createdAt']).replace('Z', '+00:00')).astimezone(kst).strftime('%Y-%m-%d %H:%M')
            writer.writerow([r['id'], csv_cell(r['author']), csv_cell(r['message']), r['color'], r['sticker'],
                             'O' if r['photo'] else '', r['hearts'], when])
        name = parse.quote(f'{title}-롤링페이퍼.csv')
        self.send(200, ('﻿' + out.getvalue()).encode(), 'text/csv; charset=utf-8',
                  extra={'Content-Disposition': f"attachment; filename*=UTF-8''{name}"})

    def get_qr(self, query):
        value = query.get('url', '')
        if len(value) > 500 or not value.startswith(('https://', 'http://')):
            raise ApiError(400, '올바른 주소가 필요해요.')
        buffer = io.BytesIO()
        qrcode.make(value, image_factory=SvgPathImage, border=2).save(buffer)
        self.send(200, buffer.getvalue(), 'image/svg+xml', 'private, max-age=3600')

    # POST ---------------------------------------------------------------------
    def do_POST(self):
        if not self.active():
            return
        routes = {'/api/boards': self.post_board, '/api/notes': self.post_note, '/api/heart': self.post_heart,
                  '/api/delete': self.post_delete, '/api/deadline': self.post_deadline}
        handler = routes.get(parse.urlsplit(self.path).path)
        if not handler:
            return self.send(404, {'error': '페이지가 없어요.'})
        def run():
            if not secrets.compare_digest(self.headers.get('X-RP-Key', ''), SESSION_KEY):
                raise ApiError(403, '서비스가 다시 시작되었어요. 새로고침해 주세요.')
            length = int(self.headers.get('Content-Length') or 0)
            if not 0 < length <= 1_000_000:
                raise ApiError(413, '내용이 너무 커요.')
            try:
                body = json.loads(self.rfile.read(length))
            except ValueError:
                raise ApiError(400, '요청 형식을 확인해 주세요.') from None
            if not isinstance(body, dict):
                raise ApiError(400, '요청 형식을 확인해 주세요.')
            handler(body)
        self.handle_api(run)

    def post_board(self, body):
        voter, _ = self.viewer()
        title = text(body.get('title'), 1, 40, '제목')
        recipient = text(body.get('recipient', ''), 0, 20, '주인공 이름')
        theme = body.get('theme')
        if theme not in THEMES:
            raise ApiError(400, '테마를 골라 주세요.')
        deadline = parse_deadline(body.get('deadline'))
        if not now() + dt.timedelta(minutes=1) <= deadline <= now() + dt.timedelta(days=7):
            raise ApiError(400, '마감은 1분 뒤부터 7일 이내로 정해 주세요.')
        if limited('board:' + voter, 3, 60) or limited('board', 20, 60):
            raise ApiError(429, '잠시 후 다시 만들어 주세요.')
        admin_key = secrets.token_urlsafe(24)
        for _ in range(3):
            code = ''.join(secrets.choice('abcdefghijkmnpqrstuvwxyz23456789') for _ in range(8))
            try:
                board = STORE.create_board(code, title, recipient, theme, deadline, bool(body.get('secret')), sha(admin_key))
                break
            except ApiError as exc:
                if exc.status != 409:
                    raise
            except Exception as exc:  # sqlite unique collision
                if 'UNIQUE' not in str(exc):
                    raise
        else:
            raise ApiError(503, '잠시 후 다시 시도해 주세요.')
        self.send(201, {'board': board, 'adminKey': admin_key})

    def post_note(self, body):
        voter, owner = self.viewer()
        code = self.code(body.get('b'))
        author = text(body.get('author', ''), 0, 12, '닉네임') or '익명'
        message = text(body.get('message'), 1, 100, '메시지')
        color, sticker, font = body.get('color'), body.get('sticker', ''), body.get('font', 'pen')
        if color not in COLORS or sticker not in STICKERS or font not in FONTS:
            raise ApiError(400, '포스트잇 꾸미기 값을 확인해 주세요.')
        photo = decode_photo(body.get('photo'))
        if limited('note:' + voter, 1, 3) or limited('note', 90, 60):
            raise ApiError(429, '조금만 천천히! 잠시 후 다시 붙여 주세요.')
        path = None
        if photo:
            if limited('photo', 30, 60):
                raise ApiError(429, '사진이 몰리고 있어요. 잠시 후 다시 시도해 주세요.')
            board = STORE.pulse(code)
            if board['closed']:
                raise ApiError(423, '마감되어 더 이상 쓸 수 없어요.')
            path = STORE.upload_photo(board, photo)
        note = STORE.add_note(code, author, message, color, sticker, font, path, owner)
        if photo:
            PHOTOS.put(path, photo)
        self.signal(code, 'note', note['id'])
        self.send(201, {'note': note})

    def post_heart(self, body):
        voter, hashed = self.viewer()
        if limited('heart:' + voter, 10, 5):
            raise ApiError(429, '하트를 너무 빨리 누르고 있어요!')
        code = self.code(body.get('b'))
        if not isinstance(body.get('id'), int):
            raise ApiError(400, '포스트잇을 확인해 주세요.')
        result = STORE.toggle_heart(code, body['id'], hashed)
        self.signal(code, 'heart', body['id'])
        self.send(200, result)

    def post_delete(self, body):
        _, owner = self.viewer()
        code = self.code(body.get('b'))
        if not isinstance(body.get('id'), int):
            raise ApiError(400, '포스트잇을 확인해 주세요.')
        result = STORE.delete_note(code, body['id'], owner, self.admin())
        self.signal(code, 'delete', body['id'])
        self.send(200, result)

    def post_deadline(self, body):
        code = self.code(body.get('b'))
        if body.get('closeNow'):
            deadline = now()
        else:
            minutes = body.get('addMinutes')
            if not isinstance(minutes, int) or not 1 <= minutes <= 1440:
                raise ApiError(400, '연장 시간을 확인해 주세요.')
            current = parse_deadline(STORE.pulse(code)['deadline'])
            deadline = max(current, now()) + dt.timedelta(minutes=minutes)
        board = STORE.set_deadline(code, self.admin(), deadline)
        self.signal(code, 'board')
        self.send(200, {'board': board})

    def signal(self, code, kind, note_id=None):
        board_id = getattr(STORE, 'board_ids', {}).get(code)
        if board_id:
            STORE.broadcast(board_id, kind, note_id)


class Server(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 64


server = Server(('0.0.0.0', int(os.environ.get('PORT', 8080))), Handler)
tunnel = None
if os.environ.get('ENABLE_TUNNEL') == '1':
    tunnel = subprocess.Popen(['cloudflared', 'tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', 'http://127.0.0.1:8080'],
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)

    def relay_tunnel():
        global PUBLIC_URL
        for line in tunnel.stdout:
            match = re.search(r'https://[a-z0-9-]+\.trycloudflare\.com', line)
            if match and not PUBLIC_URL:
                PUBLIC_URL = match.group(0)
                try:
                    STORE.set_origin(PUBLIC_URL)
                    print(f'Registered tunnel origin {PUBLIC_URL}', flush=True)
                except ApiError as exc:
                    print('Could not register origin:', exc.message, flush=True)
            if 'ERR' in line or 'trycloudflare' in line:
                print('[tunnel]', line.rstrip(), flush=True)
    threading.Thread(target=relay_tunnel, daemon=True).start()

stopping = threading.Event()


def stop(*_):
    if not stopping.is_set():
        stopping.set()
        threading.Thread(target=server.shutdown, daemon=True).start()


def expiry_watchdog():
    while not stopping.wait(min(1, max(0, END - time.time()))):
        if time.time() >= END:
            stop()


threading.Thread(target=expiry_watchdog, daemon=True).start()
signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
kst = dt.timezone(dt.timedelta(hours=9))
print(f'Rolling paper ready ({STORE.mode}); closes {dt.datetime.fromtimestamp(END, kst).isoformat()}', flush=True)
try:
    server.serve_forever()
finally:
    server.server_close()
    try:
        STORE.end()
        print('Service window closed in the database.', flush=True)
    except Exception:
        pass
    if tunnel:
        tunnel.terminate()
        try:
            tunnel.wait(timeout=5)
        except subprocess.TimeoutExpired:
            tunnel.kill()
    print('Rolling paper stopped.', flush=True)
