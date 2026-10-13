import json, os, uuid
from urllib.request import Request,urlopen
from urllib.error import HTTPError
req=Request(os.environ['SUPABASE_URL']+'/rest/v1/rpc/lunch_top',data=json.dumps({'p_session':os.environ['SUPABASE_SESSION_ID'],'p_team':'qa-probe'}).encode(),headers={'apikey':os.environ['SUPABASE_PUBLISHABLE_KEY'],'Authorization':'Bearer '+os.environ['SUPABASE_PUBLISHABLE_KEY'],'Content-Type':'application/json'})
try:
    with urlopen(req,timeout=10) as r: print(r.status,r.read().decode())
except HTTPError as e: print(e.code,e.read().decode())
