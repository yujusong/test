"""Storage backends with one contract: LocalStore (SQLite, dev/test) and SupabaseStore (cloud)."""
import base64
import datetime as dt
import json
import os
import secrets
import sqlite3
import threading
import uuid
from pathlib import Path
from urllib import error, request


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def iso(value):
    return value.astimezone(dt.timezone.utc).isoformat().replace('+00:00', 'Z')


def now():
    return dt.datetime.now(dt.timezone.utc)


class LocalStore:
    """Single-container mode used for development and automated tests."""
    mode = 'container'

    def __init__(self, path):
        self.path = path
        self.photos = Path(path).parent / 'photos'
        self.photos.mkdir(exist_ok=True)
        self.lock = threading.Lock()
        with self.db() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS boards (id TEXT PRIMARY KEY, code TEXT UNIQUE, title TEXT, recipient TEXT,
                    theme TEXT, deadline TEXT, secret INTEGER, admin_hash TEXT, rev INTEGER DEFAULT 0, created_at TEXT);
                CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY AUTOINCREMENT, board_id TEXT, author TEXT,
                    message TEXT, color TEXT, sticker TEXT, font TEXT, photo_path TEXT, hearts INTEGER DEFAULT 0,
                    owner_hash TEXT, created_at TEXT);
                CREATE TABLE IF NOT EXISTS hearts (note_id INTEGER, voter_hash TEXT, PRIMARY KEY(note_id, voter_hash));
            ''')

    def db(self):
        conn = sqlite3.connect(self.path, timeout=5)
        conn.row_factory = sqlite3.Row
        return conn

    def start(self, seconds):
        return None

    def set_origin(self, origin):
        pass

    def end(self):
        pass

    def board_row(self, db, code):
        row = db.execute('SELECT * FROM boards WHERE code=?', (code,)).fetchone()
        if not row:
            raise ApiError(404, '롤링페이퍼를 찾을 수 없어요. 링크를 확인해 주세요.')
        return row

    @staticmethod
    def closed(board):
        return dt.datetime.fromisoformat(board['deadline'].replace('Z', '+00:00')) <= now()

    def visible(self, board, owner_hash, viewer):
        return not board['secret'] or self.closed(board) or owner_hash == viewer

    def board_json(self, db, b):
        count, hearts = db.execute('SELECT COUNT(*), COALESCE(SUM(hearts),0) FROM notes WHERE board_id=?', (b['id'],)).fetchone()
        return {'id': b['id'], 'code': b['code'], 'title': b['title'], 'recipient': b['recipient'], 'theme': b['theme'],
                'deadline': b['deadline'], 'secret': bool(b['secret']), 'rev': b['rev'], 'closed': self.closed(b),
                'count': count, 'hearts': hearts}

    def note_json(self, db, n, viewer):
        hearted = db.execute('SELECT 1 FROM hearts WHERE note_id=? AND voter_hash=?', (n['id'], viewer)).fetchone()
        return {'id': n['id'], 'author': n['author'], 'message': n['message'], 'color': n['color'],
                'sticker': n['sticker'], 'font': n['font'], 'photo': bool(n['photo_path']), 'hearts': n['hearts'],
                'createdAt': n['created_at'], 'mine': n['owner_hash'] == viewer, 'hearted': bool(hearted)}

    def bump(self, db, board_id):
        db.execute('UPDATE boards SET rev=rev+1 WHERE id=?', (board_id,))

    def create_board(self, code, title, recipient, theme, deadline, secret, admin_hash):
        with self.lock, self.db() as db:
            board_id = str(uuid.uuid4())
            db.execute('INSERT INTO boards(id,code,title,recipient,theme,deadline,secret,admin_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
                       (board_id, code, title, recipient, theme, iso(deadline), int(secret), admin_hash, iso(now())))
            return self.board_json(db, self.board_row(db, code))

    def get_board(self, code, viewer):
        with self.db() as db:
            b = self.board_row(db, code)
            rows = db.execute('SELECT * FROM notes WHERE board_id=? ORDER BY id DESC', (b['id'],)).fetchall()
            notes = [self.note_json(db, n, viewer) for n in rows if self.visible(b, n['owner_hash'], viewer)]
            return {'board': self.board_json(db, b), 'notes': notes}

    def pulse(self, code):
        with self.db() as db:
            return self.board_json(db, self.board_row(db, code))

    def set_deadline(self, code, admin_hash, deadline):
        with self.lock, self.db() as db:
            b = self.board_row(db, code)
            if b['admin_hash'] != admin_hash:
                raise ApiError(403, '관리자 링크로 열어야 할 수 있어요.')
            db.execute('UPDATE boards SET deadline=?, rev=rev+1 WHERE id=?', (iso(max(deadline, now())), b['id']))
            return self.board_json(db, self.board_row(db, code))

    def upload_photo(self, board, data):
        name = f'{secrets.token_hex(16)}.jpg'
        (self.photos / name).write_bytes(data)
        return name

    def add_note(self, code, author, message, color, sticker, font, photo, owner):
        with self.lock, self.db() as db:
            b = self.board_row(db, code)
            if self.closed(b):
                raise ApiError(423, '마감되어 더 이상 쓸 수 없어요.')
            if db.execute('SELECT COUNT(*) FROM notes WHERE board_id=?', (b['id'],)).fetchone()[0] >= 300:
                raise ApiError(409, '이 보드는 가득 찼어요 (최대 300장).')
            cur = db.execute('INSERT INTO notes(board_id,author,message,color,sticker,font,photo_path,owner_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
                             (b['id'], author or '익명', message, color, sticker, font, photo, owner, iso(now())))
            self.bump(db, b['id'])
            return self.note_json(db, db.execute('SELECT * FROM notes WHERE id=?', (cur.lastrowid,)).fetchone(), owner)

    def toggle_heart(self, code, note_id, voter):
        with self.lock, self.db() as db:
            b = self.board_row(db, code)
            n = db.execute('SELECT * FROM notes WHERE id=? AND board_id=?', (note_id, b['id'])).fetchone()
            if not n or not self.visible(b, n['owner_hash'], voter):
                raise ApiError(404, '포스트잇을 찾을 수 없어요.')
            gone = db.execute('DELETE FROM hearts WHERE note_id=? AND voter_hash=?', (note_id, voter)).rowcount
            if not gone:
                db.execute('INSERT INTO hearts VALUES(?,?)', (note_id, voter))
            db.execute('UPDATE notes SET hearts=MAX(0, hearts+?) WHERE id=?', (-1 if gone else 1, note_id))
            self.bump(db, b['id'])
            total = db.execute('SELECT hearts FROM notes WHERE id=?', (note_id,)).fetchone()[0]
            return {'id': note_id, 'hearts': total, 'hearted': not gone}

    def delete_note(self, code, note_id, owner, admin_hash):
        with self.lock, self.db() as db:
            b = self.board_row(db, code)
            n = db.execute('SELECT * FROM notes WHERE id=? AND board_id=?', (note_id, b['id'])).fetchone()
            if not n or (n['owner_hash'] != owner and b['admin_hash'] != admin_hash):
                raise ApiError(403, '내가 쓴 글이거나 관리자일 때만 지울 수 있어요.')
            db.execute('DELETE FROM hearts WHERE note_id=?', (note_id,))
            db.execute('DELETE FROM notes WHERE id=?', (note_id,))
            self.bump(db, b['id'])
            if n['photo_path']:
                (self.photos / n['photo_path']).unlink(missing_ok=True)
            return {'id': note_id}

    def photo_path(self, code, note_id, viewer):
        with self.db() as db:
            b = self.board_row(db, code)
            n = db.execute('SELECT * FROM notes WHERE id=? AND board_id=?', (note_id, b['id'])).fetchone()
            if not n or not n['photo_path'] or not self.visible(b, n['owner_hash'], viewer):
                raise ApiError(404, '사진이 없어요.')
            return n['photo_path']

    def read_photo(self, path):
        return (self.photos / path).read_bytes()

    def export(self, code, admin_hash):
        with self.db() as db:
            b = self.board_row(db, code)
            if b['admin_hash'] != admin_hash:
                raise ApiError(403, '관리자 링크로 열어야 할 수 있어요.')
            rows = db.execute('SELECT * FROM notes WHERE board_id=? ORDER BY id', (b['id'],)).fetchall()
            return b['title'], [{'id': n['id'], 'author': n['author'], 'message': n['message'], 'color': n['color'],
                                 'sticker': n['sticker'], 'photo': bool(n['photo_path']), 'hearts': n['hearts'],
                                 'createdAt': n['created_at']} for n in rows]

    def broadcast(self, board_id, kind, note_id=None):
        pass


class SupabaseStore:
    """Cloud mode: every call is an RPC guarded by the container's secret session id."""
    mode = 'supabase'
    ERRORS = {
        'P0001': (410, '실습 시간이 끝나 서비스가 닫혔어요.'),
        'P0002': (404, '롤링페이퍼나 포스트잇을 찾을 수 없어요.'),
        'P0003': (423, '마감되어 더 이상 쓸 수 없어요.'),
        'P0004': (409, '이 보드는 가득 찼어요 (최대 300장).'),
        '42501': (403, '권한이 없어요.'),
        '22023': (400, '마감 시간을 확인해 주세요.'),
        '23514': (400, '입력 내용을 확인해 주세요.'),
        '23505': (409, '이미 사용 중인 값이에요. 다시 시도해 주세요.'),
    }

    def __init__(self, url, key, bootstrap):
        self.url, self.key, self.bootstrap = url.rstrip('/'), key, bootstrap
        self.session = None
        self.board_ids = {}

    def http(self, method, path, body=None, content_type='application/json', timeout=10):
        data = json.dumps(body).encode() if content_type == 'application/json' and body is not None else body
        req = request.Request(self.url + path, data=data, method=method, headers={
            'apikey': self.key, 'Authorization': 'Bearer ' + self.key, 'Content-Type': content_type})
        with request.urlopen(req, timeout=timeout) as res:
            return res.read()

    def rpc(self, name, **params):
        try:
            raw = self.http('POST', '/rest/v1/rpc/' + name, params)
        except error.HTTPError as exc:
            try:
                code = json.loads(exc.read()).get('code', '')
            except Exception:
                code = ''
            status, message = self.ERRORS.get(code, (503, '저장소에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.'))
            raise ApiError(status, message) from None
        except (error.URLError, TimeoutError, OSError):
            raise ApiError(503, '저장소에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.') from None
        return json.loads(raw) if raw else None

    def start(self, seconds):
        data = self.rpc('rp_start_session', p_secret=self.bootstrap, p_seconds=int(seconds))
        self.session = data['id']
        return dt.datetime.fromisoformat(data['expiresAt'].replace('Z', '+00:00')).timestamp()

    def set_origin(self, origin):
        self.rpc('rp_set_origin', p_session=self.session, p_origin=origin)

    def end(self):
        if self.session:
            self.rpc('rp_end_session', p_session=self.session)

    def remember(self, board):
        self.board_ids[board['code']] = board['id']
        return board

    def create_board(self, code, title, recipient, theme, deadline, secret, admin_hash):
        return self.remember(self.rpc('rp_create_board', p_session=self.session, p_code=code, p_title=title,
                                      p_recipient=recipient, p_theme=theme, p_deadline=iso(deadline),
                                      p_secret=secret, p_admin_hash=admin_hash))

    def get_board(self, code, viewer):
        data = self.rpc('rp_get_board', p_session=self.session, p_code=code, p_viewer=viewer)
        self.remember(data['board'])
        return data

    def pulse(self, code):
        return self.remember(self.rpc('rp_pulse', p_session=self.session, p_code=code))

    def set_deadline(self, code, admin_hash, deadline):
        return self.remember(self.rpc('rp_set_deadline', p_session=self.session, p_code=code,
                                      p_admin_hash=admin_hash, p_deadline=iso(deadline)))

    def upload_photo(self, board, data):
        path = f'{self.session}/{board["id"]}/{secrets.token_hex(16)}.jpg'
        try:
            self.http('POST', '/storage/v1/object/rp-photos/' + path, data, 'image/jpeg', timeout=20)
        except (error.URLError, TimeoutError, OSError):
            raise ApiError(503, '사진을 올리지 못했어요. 잠시 후 다시 시도해 주세요.') from None
        return path

    def add_note(self, code, author, message, color, sticker, font, photo, owner):
        return self.rpc('rp_add_note', p_session=self.session, p_code=code, p_author=author, p_message=message,
                        p_color=color, p_sticker=sticker, p_font=font, p_photo=photo, p_owner=owner)

    def toggle_heart(self, code, note_id, voter):
        return self.rpc('rp_toggle_heart', p_session=self.session, p_code=code, p_note=note_id, p_voter=voter)

    def delete_note(self, code, note_id, owner, admin_hash):
        return self.rpc('rp_delete_note', p_session=self.session, p_code=code, p_note=note_id,
                        p_owner=owner, p_admin_hash=admin_hash)

    def photo_path(self, code, note_id, viewer):
        path = self.rpc('rp_photo_path', p_session=self.session, p_code=code, p_note=note_id, p_viewer=viewer)
        if not path:
            raise ApiError(404, '사진이 없어요.')
        return path

    def read_photo(self, path):
        try:
            return self.http('GET', '/storage/v1/object/public/rp-photos/' + path, timeout=15)
        except (error.URLError, TimeoutError, OSError):
            raise ApiError(503, '사진을 불러오지 못했어요.') from None

    def export(self, code, admin_hash):
        rows = self.rpc('rp_export', p_session=self.session, p_code=code, p_admin_hash=admin_hash)
        return self.pulse(code)['title'], rows

    def broadcast(self, board_id, kind, note_id=None):
        """Realtime signal only; clients refetch through the container, so a spoofed message cannot inject content."""
        message = {'topic': f'rp-{board_id}', 'event': 'sync', 'private': False,
                   'payload': {'kind': kind, 'id': note_id}}
        def send():
            try:
                self.http('POST', '/realtime/v1/api/broadcast', {'messages': [message]}, timeout=5)
            except Exception:
                pass  # The 15-second pulse still catches up.
        threading.Thread(target=send, daemon=True).start()


def decode_photo(value):
    if value in (None, ''):
        return None
    if not isinstance(value, str) or len(value) > 960_000:
        raise ApiError(413, '사진이 너무 커요. 다른 사진을 골라 주세요.')
    try:
        data = base64.b64decode(value.split(',', 1)[-1], validate=True)
    except ValueError:
        raise ApiError(400, '사진 형식을 확인해 주세요.') from None
    if len(data) > 700 * 1024 or not data.startswith(b'\xff\xd8\xff') or b'\xff\xd9' not in data[-16:]:
        raise ApiError(400, '사진 형식을 확인해 주세요.')
    return data


def make_store():
    url, key, boot = (os.environ.get(k, '') for k in ('SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'BOOTSTRAP_SECRET'))
    if url and key and boot:
        return SupabaseStore(url, key, boot)
    return LocalStore(os.environ.get('DATA_PATH', '/data/paper.sqlite'))
