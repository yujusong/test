import json
import time
import uuid
from urllib.request import Request, urlopen
from urllib.error import HTTPError
import os

BASE = os.environ.get('BASE_URL', 'http://host.docker.internal:18081')

def call(path, payload=None, key=None):
    headers = {'Content-Type': 'application/json'}
    if key: headers['X-Lunch-Session'] = key
    req = Request(BASE + path, data=None if payload is None else json.dumps(payload).encode(), headers=headers)
    try:
        with urlopen(req, timeout=10) as response:
            return response.status, json.load(response)
    except HTTPError as exc:
        body = exc.read()
        try:
            result = json.loads(body)
        except (ValueError, UnicodeDecodeError):
            result = {'error': body.decode('utf-8', errors='replace')}
        return exc.code, result

status, session = call('/api/session')
assert status == 200 and session['expiresAt'] > session['serverTime']
team = 'QA-' + uuid.uuid4().hex[:12]
vote = {'team':team, 'menu':'김치찌개', 'voter':str(uuid.uuid4())}
assert call('/api/vote', vote)[0] == 403
assert call('/api/vote', dict(vote, menu='x'*21), session['sessionKey'])[0] == 400
assert call('/api/vote', vote, session['sessionKey'])[0] == 201
time.sleep(1.1)
assert call('/api/vote', vote, session['sessionKey'])[0] == 409
status, result = call('/api/top?team=' + team)
assert status == 200 and result['rows'] == [{'menu':'김치찌개', 'count':1}]
assert call('/api/top?team=' + team + '-other')[1]['rows'] == []
assert call('/../server.py')[0] in (400, 404)  # Vercel rejects traversal before the app.
assert call('/api/qr?url=bad')[0] == 400
print('PASS: session expiry metadata, invalid input, request token, vote persistence, duplicate protection, team isolation, static path allowlist, QR input validation')
