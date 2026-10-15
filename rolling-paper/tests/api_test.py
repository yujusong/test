"""HTTP contract test. Usage: python api_test.py http://host.docker.internal:18082"""
import base64
import datetime as dt
import json
import secrets
import sys
import time
from urllib import error, request

BASE = sys.argv[1].rstrip('/') if len(sys.argv) > 1 else 'http://host.docker.internal:18082'


def call(path, body=None, voter=None, key=None, admin=None, ua=None, raw=False):
    headers = {'Content-Type': 'application/json'}
    if voter: headers['X-RP-Voter'] = voter
    if key: headers['X-RP-Key'] = key
    if admin: headers['X-RP-Admin'] = admin
    if ua: headers['User-Agent'] = ua
    data = json.dumps(body).encode() if body is not None else None
    req = request.Request(BASE + path, data=data, headers=headers, method='POST' if data else 'GET')
    try:
        with request.urlopen(req, timeout=20) as r:
            payload = r.read()
            return r.status, payload if raw else json.loads(payload or b'{}'), dict(r.headers)
    except error.HTTPError as e:
        payload = e.read()
        try:
            payload = json.loads(payload)
        except ValueError:
            pass
        return e.code, payload, dict(e.headers)


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def voter():
    return secrets.token_hex(16)


def iso(minutes):
    return (dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=minutes)).isoformat()


checks = []
def check(name, cond, detail=''):
    checks.append(name)
    if not cond:
        raise SystemExit(f'FAIL: {name} {detail}')


s, sess, h = call('/api/session')
check('session', s == 200 and sess['key'] and sess['expiresAt'] > sess['serverTime'])
check('csp header', "frame-ancestors 'none'" in h.get('Content-Security-Policy', ''))
K = sess['key']
A, B, C = voter(), voter(), voter()

# 모바일 자동 전환
opener = request.build_opener(NoRedirect)
try:
    opener.open(request.Request(BASE + '/?b=abcdefgh', headers={'User-Agent': 'Mozilla/5.0 (Linux; Android 14) Mobile'}))
    check('mobile redirect', False, 'no redirect')
except error.HTTPError as e:
    check('mobile redirect', e.code == 302 and e.headers['Location'] == '/m/?b=abcdefgh', e.headers.get('Location'))
s, _, _ = call('/?view=desktop', ua='iPhone Mobile', raw=True)
check('desktop override', s == 200)
s, page, _ = call('/m/', raw=True)
check('mobile page', s == 200 and b'app.js' in page)

# 보드 만들기와 검증
s, r, _ = call('/api/boards', {'title': 'x', 'theme': 'birthday', 'deadline': iso(30)}, A)
check('board needs session key', s == 403)
s, r, _ = call('/api/boards', {'title': 'x', 'theme': 'nope', 'deadline': iso(30)}, A, K)
check('bad theme', s == 400)
s, r, _ = call('/api/boards', {'title': 'x', 'theme': 'birthday', 'deadline': iso(-5)}, A, K)
check('past deadline', s == 400)
s, r, _ = call('/api/boards', {'title': '지수님 생일 축하해요!', 'recipient': '지수', 'theme': 'birthday', 'deadline': iso(30)}, A, K)
check('create board', s == 201 and len(r['board']['code']) == 8 and r['adminKey'], r)
code, admin = r['board']['code'], r['adminKey']

# 포스트잇
s, r, _ = call('/api/notes', {'b': code, 'message': '<img src=x onerror=alert(1)>', 'color': 'pink', 'sticker': 'cake', 'font': 'round'}, B, K)
check('add note', s == 201 and r['note']['author'] == '익명' and r['note']['mine'], r)
note1 = r['note']['id']
s, r, _ = call('/api/notes', {'b': code, 'message': 'a' * 101, 'color': 'pink'}, C, K)
check('message length', s == 400)
s, r, _ = call('/api/notes', {'b': code, 'message': 'hi', 'color': 'purple'}, C, K)
check('bad color', s == 400)
s, r, _ = call('/api/notes', {'b': code, 'message': '두 번째', 'color': 'mint'}, B, K)
check('rate limit', s == 429)
time.sleep(3.2)
jpeg = b'\xff\xd8\xff\xe0' + secrets.token_bytes(2000) + b'\xff\xd9'
s, r, _ = call('/api/notes', {'b': code, 'author': '=cmd|calc', 'message': '사진 포스트잇', 'color': 'blue', 'photo': base64.b64encode(jpeg).decode()}, B, K)
check('photo note', s == 201 and r['note']['photo'], r)
note2 = r['note']['id']
s, r, _ = call('/api/notes', {'b': code, 'message': 'png?', 'color': 'blue', 'photo': base64.b64encode(b'\x89PNG....').decode()}, C, K)
check('reject non-jpeg', s == 400)
s, img, h = call(f'/api/photo?b={code}&id={note2}', voter=C, raw=True)
check('photo download', s == 200 and img == jpeg and h['Content-Type'] == 'image/jpeg')

s, r, _ = call(f'/api/board?b={code}', voter=C)
check('board read', s == 200 and len(r['notes']) == 2 and r['notes'][0]['id'] == note2 and r['board']['count'] == 2)
check('stored as text', r['notes'][1]['message'] == '<img src=x onerror=alert(1)>')
check('not mine for others', not any(n['mine'] for n in r['notes']))

# 하트 토글
s, r, _ = call('/api/heart', {'b': code, 'id': note1}, C, K)
check('heart on', s == 200 and r['hearts'] == 1 and r['hearted'])
s, r, _ = call('/api/heart', {'b': code, 'id': note1}, A, K)
check('heart second voter', r['hearts'] == 2)
s, r, _ = call('/api/heart', {'b': code, 'id': note1}, C, K)
check('heart off', r['hearts'] == 1 and not r['hearted'])
s, r, _ = call(f'/api/pulse?b={code}')
check('pulse', s == 200 and r['board']['hearts'] == 1 and r['board']['rev'] >= 5, r)

# 삭제 권한
s, r, _ = call('/api/delete', {'b': code, 'id': note1}, C, K)
check('stranger cannot delete', s == 403)
s, r, _ = call('/api/delete', {'b': code, 'id': note1}, B, K)
check('owner deletes', s == 200)

# CSV (관리자 전용, 수식 주입 방지)
s, r, _ = call(f'/api/export?b={code}', voter=C)
check('export needs admin', s == 403)
s, csv, h = call(f'/api/export?b={code}', voter=C, admin=admin, raw=True)
text = csv.decode('utf-8-sig')
check('export csv', s == 200 and "'=cmd|calc" in text and '사진 포스트잇' in text and 'attachment' in h['Content-Disposition'])

# 비밀 모드: 마감 전엔 남의 글이 안 보이고, 마감하면 공개
s, r, _ = call('/api/boards', {'title': '몰래 준비', 'theme': 'farewell', 'deadline': iso(20), 'secret': True}, A, K)
scode, sadmin = r['board']['code'], r['adminKey']
time.sleep(3.2)
s, r, _ = call('/api/notes', {'b': scode, 'message': '비밀 메시지', 'color': 'yellow'}, B, K)
secret_note = r['note']['id']
s, r, _ = call(f'/api/board?b={scode}', voter=C)
check('secret hidden', r['notes'] == [] and r['board']['count'] == 1, r)
s, r, _ = call(f'/api/board?b={scode}', voter=B)
check('secret visible to author', len(r['notes']) == 1)
s, r, _ = call('/api/heart', {'b': scode, 'id': secret_note}, C, K)
check('secret not heartable', s == 404)
s, r, _ = call('/api/deadline', {'b': scode, 'closeNow': True}, C, K)
check('close needs admin', s == 403)
s, r, _ = call('/api/deadline', {'b': scode, 'closeNow': True}, C, K, admin=sadmin)
check('admin closes', s == 200 and r['board']['closed'])
s, r, _ = call(f'/api/board?b={scode}', voter=C)
check('revealed after deadline', len(r['notes']) == 1 and r['notes'][0]['message'] == '비밀 메시지')
time.sleep(3.2)
s, r, _ = call('/api/notes', {'b': scode, 'message': '늦었다', 'color': 'yellow'}, C, K)
check('locked after deadline', s == 423)
s, r, _ = call('/api/deadline', {'b': scode, 'addMinutes': 10}, C, K, admin=sadmin)
check('admin extends', s == 200 and not r['board']['closed'])

s, r, _ = call('/api/board?b=zzzzzzzz', voter=C)
check('unknown board', s == 404)
s, svg, h = call('/api/qr?url=https%3A%2F%2Fexample.com%2F%3Fb%3Dabc', raw=True)
check('qr', s == 200 and svg.startswith(b'<?xml') and h['Content-Type'] == 'image/svg+xml')
s, r, _ = call('/api/notes', {'b': code, 'message': 'x', 'color': 'yellow'}, 'short', K)
check('voter id required', s == 400)

print(f'PASS {len(checks)} checks: ' + ', '.join(checks))
