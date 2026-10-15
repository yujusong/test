"""Headless browser test. Usage: python browser_test.py http://host.docker.internal:18082"""
import struct
import sys
import zlib
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

BASE = sys.argv[1].rstrip('/') if len(sys.argv) > 1 else 'http://host.docker.internal:18082'
OUT = Path('/artifacts')
OUT.mkdir(exist_ok=True)
IPHONE = ('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 '
          '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1')


def png(width=320, height=240):
    rows = b''.join(b'\x00' + b''.join(bytes((x * 255 // width, y * 255 // height, 160)) for x in range(width))
                    for y in range(height))
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b''))


errors = []
def watch(page, name):
    page.on('pageerror', lambda exc: errors.append(f'{name}: {exc}'))
    page.on('console', lambda m: m.type == 'error' and 'fonts.g' not in m.text and errors.append(f'{name} console: {m.text}'))


with sync_playwright() as p:
    browser = p.chromium.launch()

    # 1) PC: 처음 화면 → 보드 만들기
    desk = browser.new_context(viewport={'width': 1366, 'height': 900})
    a = desk.new_page()
    watch(a, 'desktop')
    a.goto(BASE + '/')
    expect(a.locator('#home')).to_be_visible()
    a.screenshot(path=str(OUT / 'desktop-home.png'), full_page=True)
    a.locator('label.chip-radio', has_text='🎂 생일').click()
    a.fill('#create [name=recipient]', '지수')
    expect(a.locator('#create [name=title]')).to_have_value('지수님 생일 축하해요!')
    a.locator('label.chip-radio', has_text='30분 뒤').click()
    a.locator('#create button[type=submit]').click()
    expect(a.locator('#board')).to_be_visible()
    expect(a.locator('#invite')).to_be_visible()
    expect(a.locator('#qr')).to_have_js_property('complete', True)
    assert a.locator('#qr').evaluate('i => i.naturalWidth > 0')
    assert '#admin=' in a.locator('#admin-link').input_value()
    code = a.evaluate("new URLSearchParams(location.search).get('b')")
    a.locator('#invite .close').click()
    expect(a.locator('#board-title')).to_have_text('지수님 생일 축하해요!')
    expect(a.locator('#countdown')).to_contain_text('마감까지')
    expect(a.locator('#admin-btn')).to_be_visible()

    # 2) 포스트잇 + 사진(폴라로이드)
    a.fill('#note-form [name=author]', '민지')
    a.fill('#note-form [name=message]', '생일 축하해요! <b>최고</b>')
    expect(a.locator('#preview .msg')).to_have_text('생일 축하해요! <b>최고</b>')
    a.locator('#colors label[title=분홍]').click()
    a.locator('#stickers label[title="🎂"]').click()
    a.locator('#photo').set_input_files({'name': 'photo.png', 'mimeType': 'image/png', 'buffer': png()})
    expect(a.locator('#photo-info')).to_contain_text('KB로 줄였어요')
    a.locator('#submit').click()
    first = a.locator('#wall .note').first
    expect(first).to_have_class('note c-pink f-pen has-photo mine fresh')
    expect(first.locator('.msg')).to_have_text('생일 축하해요! <b>최고</b>')
    assert a.locator('#wall .msg b').count() == 0
    expect(first.locator('.polaroid img')).to_have_js_property('complete', True)
    assert first.locator('.polaroid img').evaluate('i => i.naturalWidth > 0')
    expect(a.locator('#stats')).to_contain_text('1장')

    # 3) 다른 사람(다른 브라우저)이 보고, 하트 누르고, 새 글 → A 화면에 실시간 반영
    other = browser.new_context(viewport={'width': 1280, 'height': 860})
    b = other.new_page()
    watch(b, 'friend')
    b.goto(f'{BASE}/?b={code}')
    expect(b.locator('#wall .note')).to_have_count(1)
    expect(b.locator('#admin-btn')).to_be_hidden()
    expect(b.locator('#wall .note .polaroid img')).to_have_js_property('complete', True)
    cloud = a.evaluate("fetch('/api/session').then(r => r.json()).then(d => d.mode)") == 'supabase'
    if cloud:  # Presence only exists through Supabase Realtime
        expect(a.locator('#viewers')).to_have_text('👀 2명 보는 중', timeout=15000)
        b.locator('#note-form [name=message]').press_sequentially('쓰는 중')
        expect(a.locator('#typing')).to_have_text('✍️ 1명이 쓰는 중…', timeout=10000)
        b.fill('#note-form [name=message]', '')
    b.locator('#wall .heart').first.click()
    expect(b.locator('#wall .heart').first).to_have_attribute('aria-pressed', 'true')
    b.locator('#idea').click()
    assert b.locator('#note-form [name=message]').input_value()
    b.locator('#colors label[title=민트]').click()
    b.locator('#fonts label[title=또박또박]').click()
    b.locator('#submit').click()
    expect(b.locator('#wall .note')).to_have_count(2)
    # Realtime broadcast should beat the 15s fallback poll comfortably in cloud mode.
    live_wait = 6000 if cloud else 12000
    expect(a.locator('#wall .note')).to_have_count(2, timeout=live_wait)
    expect(a.locator('#wall .note.has-photo .h-count')).to_have_text('1', timeout=live_wait)
    b.locator('#wall .note.mine .del').click()
    b.locator('#confirm button[value=ok]').click()
    expect(b.locator('#wall .note')).to_have_count(1)
    expect(a.locator('#wall .note')).to_have_count(1, timeout=12000)
    a.locator('.seg [data-sort=photos]').click()
    expect(a.locator('#wall .note')).to_have_count(1)
    a.locator('.seg [data-sort=new]').click()
    a.screenshot(path=str(OUT / 'desktop-board.png'), full_page=True)

    # 4) 모바일: 같은 주소 → /m/ 자동 전환, 하단 탭과 바텀시트
    phone = browser.new_context(viewport={'width': 390, 'height': 844}, user_agent=IPHONE, is_mobile=True,
                                has_touch=True, device_scale_factor=2)
    m = phone.new_page()
    watch(m, 'mobile')
    m.goto(f'{BASE}/?b={code}')
    assert '/m/' in m.url, m.url
    expect(m.locator('#wall .note')).to_have_count(1)
    expect(m.locator('.tabbar')).to_be_visible()
    expect(m.locator('#composer')).to_be_hidden()
    assert m.evaluate('() => document.documentElement.scrollWidth <= innerWidth')
    m.screenshot(path=str(OUT / 'mobile-board.png'))
    m.locator('.tabbar [data-tab=write]').click()
    expect(m.locator('#composer')).to_be_visible()
    m.fill('#note-form [name=message]', '모바일에서 남겨요 📱')
    m.screenshot(path=str(OUT / 'mobile-sheet.png'))
    m.locator('#submit').click()
    expect(m.locator('#composer')).to_be_hidden()
    expect(m.locator('#wall .note')).to_have_count(2)
    expect(a.locator('#wall .note')).to_have_count(2, timeout=12000)
    expect(m.locator('#switch-ui')).to_have_attribute('href', f'/?view=desktop&b={code}')

    # 5) 좁은 PC 창도 동적으로 바텀시트 레이아웃으로 전환
    a.set_viewport_size({'width': 700, 'height': 900})
    expect(a.locator('#fab')).to_be_visible()
    a.set_viewport_size({'width': 1366, 'height': 900})
    expect(a.locator('#fab')).to_be_hidden()

    # 6) 관리자: 지금 마감 → 잠금 → 공개 모드
    a.locator('#admin-btn').click()
    a.locator('#close-now').click()
    a.locator('#confirm button[value=ok]').click()
    expect(a.locator('#countdown')).to_have_text('🔒 마감')
    expect(a.locator('#locked')).to_be_visible()
    expect(m.locator('.tabbar [data-tab=write]')).to_be_visible()
    expect(m.locator('#countdown')).to_have_text('🔒 마감', timeout=12000)
    a.locator('#locked [data-open=show]').click()
    expect(a.locator('#show')).to_be_visible()
    expect(a.locator('#show-count')).to_have_text('1 / 2')
    a.screenshot(path=str(OUT / 'desktop-show.png'))
    a.keyboard.press('ArrowRight')
    a.keyboard.press('ArrowRight')
    expect(a.locator('.show-end h2')).to_have_text('2장의 마음이 모였어요')
    a.keyboard.press('Escape')
    expect(a.locator('#show')).to_be_hidden()

    # 7) 비밀 모드: 마감 전엔 접힌 카드, 마감 순간 공개
    a.goto(BASE + '/')
    a.locator('label.chip-radio', has_text='👋 송별').click()
    a.fill('#create [name=recipient]', '준호')
    a.locator('#create .switch').click()
    a.locator('#create button[type=submit]').click()
    expect(a.locator('#invite')).to_be_visible()
    a.locator('#invite .close').click()
    scode = a.evaluate("new URLSearchParams(location.search).get('b')")
    expect(a.locator('#secret-note')).to_be_visible()
    b.goto(f'{BASE}/?b={scode}')
    b.fill('#note-form [name=message]', '몰래 쓰는 송별 메시지')
    b.locator('#submit').click()
    expect(b.locator('#wall .note')).to_have_count(1)
    expect(a.locator('#wall .note.folded')).to_have_count(1, timeout=12000)
    assert '몰래 쓰는' not in a.locator('#wall').inner_text()
    a.screenshot(path=str(OUT / 'desktop-secret.png'), full_page=True)
    a.locator('[data-open=show]').first.click()
    expect(a.locator('#show')).to_be_hidden()
    a.locator('#admin-btn').click()
    a.locator('#close-now').click()
    a.locator('#confirm button[value=ok]').click()
    expect(a.locator('#wall .note:not(.folded) .msg')).to_have_text('몰래 쓰는 송별 메시지')
    expect(b.locator('#countdown')).to_have_text('🔓 공개되었어요', timeout=12000)

    # 8) 처음 화면에 최근 보드가 기억된다
    a.goto(BASE + '/')
    expect(a.locator('#recent-list li')).to_have_count(2)

    assert not errors, errors
    browser.close()

print('PASS: create board, invite QR/admin link, note+photo polaroid, safe text, hearts, ideas, delete, '
      'cross-browser live updates, sort filter, mobile redirect + tabbar + sheet, dynamic compact layout, '
      'admin close + lock, slideshow, secret mode fold/reveal, recent boards, no console errors')
