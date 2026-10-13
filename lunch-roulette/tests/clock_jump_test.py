import os
import runpy
import threading
import time

# Simulate a laptop waking after its deadline without waiting an hour.
original_time = time.time
offset = 0
time.time = lambda: original_time() + offset
os.environ['SESSION_SECONDS'] = '60'
os.environ['SESSION_EXPIRES_AT'] = ''
os.environ['ENABLE_TUNNEL'] = '0'
os.environ['DATA_PATH'] = '/tmp/clock-jump.sqlite'
os.environ['PORT'] = '0'

def jump_clock():
    global offset
    time.sleep(1)
    offset = 120

threading.Thread(target=jump_clock, daemon=True).start()
started = time.monotonic()
runpy.run_path('/app/server.py', run_name='__main__')
assert time.monotonic() - started < 5, 'Expired server remained alive after clock jump'
print('PASS: server exits promptly after wall clock passes deadline')
