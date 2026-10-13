import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

out = Path('/artifacts')
out.mkdir(exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width':1360,'height':1200})
    errors = []
    page.on('pageerror', lambda exc: errors.append(str(exc)))
    page.goto('http://host.docker.internal:18081/?team=browser-qa')
    expect(page.locator('#spin')).to_be_enabled()
    assert page.locator('#menus li').count() == 6
    page.locator('#spin').click()
    assert page.locator('#spin').is_disabled()
    page.locator('#vote').wait_for(state='visible')
    assert page.locator('#result-menu').inner_text() not in ['', '맛있는 운명을 고르는 중…']
    page.locator('#vote').click()
    expect(page.locator('#vote')).to_have_text('오늘 투표 완료 ✓')
    assert '1표' in page.locator('#top').inner_text()
    page.locator('#new-menu').fill('<b>비빔밥</b>')
    page.locator('#add-form button').click()
    assert page.locator('#menus li').count() == 7
    assert page.locator('#menus b').count() == 0
    page.get_by_role('button',name='<b>비빔밥</b> 삭제',exact=True).click()
    assert page.locator('#menus li').count() == 6
    page.get_by_role('button',name='국물 당기는 날',exact=True).click()
    assert page.locator('#menus input:checked').count() == 3
    page.get_by_role('button',name='기본 메뉴',exact=True).click()
    page.screenshot(path=str(out / 'desktop.png'), full_page=True)
    page.reload()
    expect(page.locator('#spin')).to_be_enabled()
    page.locator('#spin').click()
    page.locator('#vote').wait_for(state='visible')
    assert page.locator('#vote').is_disabled()
    mobile = browser.new_page(viewport={'width':390,'height':844},is_mobile=True,device_scale_factor=1)
    mobile.goto('http://host.docker.internal:18081/?team=browser-qa')
    expect(mobile.locator('#spin')).to_be_enabled()
    assert mobile.evaluate('() => document.documentElement.scrollWidth <= innerWidth')
    mobile.screenshot(path=str(out / 'mobile.png'), full_page=True)
    assert not errors, errors
    browser.close()
print('PASS: roulette, spin lock, vote, ranking, persistent vote lock, add/remove, safe text rendering, filters, mobile overflow, console errors')
