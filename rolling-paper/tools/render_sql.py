"""Create/keep BOOTSTRAP_SECRET in .env and render supabase/schema.local.sql with its sha256.

Run from the project root inside a container:  python tools/render_sql.py
The secret itself never goes into the SQL or Git; only its hash is stored in Supabase.
"""
import hashlib
import secrets
from pathlib import Path

root = Path(__file__).resolve().parent.parent
env_path = root / '.env'
lines = env_path.read_text(encoding='utf-8').splitlines() if env_path.exists() else \
    (root / '.env.example').read_text(encoding='utf-8').splitlines()
values = dict(line.split('=', 1) for line in lines if '=' in line and not line.startswith('#'))
secret = values.get('BOOTSTRAP_SECRET') or secrets.token_urlsafe(32)
if values.get('BOOTSTRAP_SECRET') != secret:
    lines = [f'BOOTSTRAP_SECRET={secret}' if line.startswith('BOOTSTRAP_SECRET=') else line for line in lines]
    if not any(line.startswith('BOOTSTRAP_SECRET=') for line in lines):
        lines.append(f'BOOTSTRAP_SECRET={secret}')
    env_path.write_text('\n'.join(lines) + '\n', encoding='utf-8')
digest = hashlib.sha256(secret.encode()).hexdigest()
sql = (root / 'supabase' / 'schema.sql').read_text(encoding='utf-8').replace('__BOOTSTRAP_HASH__', digest)
(root / 'supabase' / 'schema.local.sql').write_text(sql, encoding='utf-8')
print('Rendered supabase/schema.local.sql (bootstrap hash only; secret kept in .env).')
