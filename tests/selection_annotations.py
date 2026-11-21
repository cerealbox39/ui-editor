"""Selection rings, multi-element notes and build-v2 evidence.

Run: python3 tests/selection_annotations.py [--evidence]
Requires Playwright and Pillow, using the same Chromium as mobile_annotations.py.
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from playwright.sync_api import expect, sync_playwright

from mobile_annotations import CHROME, serve, touch_drag, overlaps

OUT = Path.home() / 'annotation-evidence' / 'build-v2'
DARK = '''@media(prefers-color-scheme:dark){:root{--bg:#111317;--surface:#1b1e23;
--text:#f1f3f6;--text-muted:#a9b0bc;--border:rgba(255,255,255,.12);--good:#76d7a4;
--bad:#ff9388;--warn:#f0bc69;--accent:#6aa6ff}}'''


def start(browser, url, theme):
    ctx = browser.new_context(viewport={'width':1440,'height':1000}, device_scale_factor=2,
                              color_scheme=theme, ignore_https_errors=True,
                              permissions=['clipboard-read','clipboard-write'])
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.add_init_script("localStorage.setItem('demo:intro-hidden','1')")
    page.goto(url)
    page.add_style_tag(content=DARK)
    page.evaluate('document.fonts.ready')
    page.locator('.pin-toggle').click()
    return ctx, page, errors


def saved(page):
    return page.evaluate("JSON.parse(localStorage.getItem('pin-overlay:'+location.href)||'[]')")


def drag(page, start, end):
    page.mouse.move(*start)
    page.mouse.down()
    page.mouse.move(*end, steps=15)
    page.mouse.up()


def arrow(page, multi=False, kpi=False):
    source = page.locator('.kpi').first if multi or kpi else page.get_by_role('button',name='Export CSV',exact=True)
    r, s = source.bounding_box(), page.locator('#search').bounding_box()
    if multi:
        last = page.locator('.kpi').nth(2).bounding_box()
        x = (r['x'] + last['x'] + last['width']) / 2
    else:
        x = r['x'] + r['width'] / 2
    drag(page, (x,r['y']+r['height']+8), (s['x']-20,s['y']+s['height']/2))


def annotate(page, mark='Move'):
    page.get_by_role('button',name='Annotate',exact=True).click()
    page.locator('.pin-mark-picker').get_by_role('button',name=mark,exact=True).click()
    return page.locator('.pin-annotation-prompt')


def save(page, count):
    page.locator('.pin-annotation-prompt').get_by_role('button',name='Save',exact=True).click()
    expect(page.locator('.pin-card')).to_have_count(count)


def copy(page):
    page.get_by_role('button',name='Copy all',exact=True).click()
    page.wait_for_function("document.querySelector('.pin-status').textContent.startsWith('Clipboard updated')")
    return page.evaluate('navigator.clipboard.readText()')


def select_cards(page):
    for i in range(3):
        page.locator('.kpi').nth(i).click(position={'x':12,'y':12}, modifiers=['Shift'])


def checks(browser, url, theme):
    ctx, page, errors = start(browser,url,theme)
    source = page.get_by_role('button',name='Export CSV',exact=True)
    source.click()
    expect(page.locator('.pin-selection-hint')).to_have_text('Hold Shift and click to select more')
    prompt = annotate(page)
    expect(page.locator('[data-draft] rect')).to_have_count(1)
    expect(prompt.locator('.pin-circle-step')).to_have_text('✓ Export CSV selected')
    expect(prompt.locator('.pin-circle-step')).to_have_attribute('aria-label','Circle something else')
    expect(prompt.locator('.pin-circle-step')).to_have_attribute('title','Circle something else')
    expect(prompt.get_by_role('button',name='Save',exact=True)).to_be_disabled()
    r = source.bounding_box()
    rect = page.locator('[data-draft] rect')
    assert float(rect.get_attribute('x')) == r['x']-6
    assert float(rect.get_attribute('width')) == r['width']+12
    arrow(page)
    save(page,1)
    note = saved(page)[0]
    assert note['annotation']['circle'] is None
    assert len(note['annotation']['rings']) == 1
    assert note['annotation']['destination']['element']['selector'] == '#search'
    assert 'to just left of the search field' in copy(page)
    before = note['annotation']['rings']
    page.evaluate('window.scrollBy(0,100)')
    assert saved(page)[0]['annotation']['rings'] == before
    page.reload();page.locator('.pin-toggle').click()
    expect(page.locator('[data-note-id] rect')).to_have_count(1)
    expect(page.locator('.pin-annotation-dot text')).to_have_text('1')
    print(f'PASS selection {theme}: default padded ring; arrow-only Move; Save, Copy all, document coordinates and reload')

    for count, mark in enumerate(['Remove','Highlight'],2):
        source.click();prompt=annotate(page,mark)
        expect(prompt.get_by_role('button',name='Save',exact=True)).to_be_enabled()
        if mark == 'Remove':
            assert 'optional' in prompt.inner_text()
            assert page.locator('[data-draft] rect').evaluate('el=>getComputedStyle(el).stroke') != 'rgb(0, 113, 227)'
        save(page,count)
        assert saved(page)[-1]['annotation']['stroke'] is None
    print(f'PASS selection {theme}: Remove red ring and Highlight save without drawing; X optional')

    source.click();page.locator('.pin-comment').fill('Keep my draft')
    prompt=annotate(page)
    prompt.get_by_role('button',name='Circle something else',exact=True).click()
    drag(page,(500,300),(501,301))
    expect(page.locator('[data-draft] rect')).to_have_count(1)
    drag(page,(r['x']-10,r['y']-8),(r['x']+r['width']+10,r['y']+r['height']+8))
    expect(page.locator('[data-draft] rect')).to_have_count(0)
    expect(page.locator('[data-draft] ellipse')).to_have_count(1)
    arrow(page)
    prompt.locator('.pin-circle-step').click()
    drag(page,(r['x']-15,r['y']-9),(r['x']+r['width']+20,r['y']+r['height']+10))
    expect(page.locator('[data-draft] .pin-annotation-stroke')).to_have_count(0)
    expect(prompt.get_by_role('button',name='Save',exact=True)).to_be_disabled()
    page.keyboard.press('Escape')
    expect(page.locator('.pin-comment')).to_have_value('Keep my draft')
    expect(page.locator('.pin-card')).to_have_count(3)
    page.locator('.pin-editor').get_by_role('button',name='Cancel',exact=True).click()
    print(f'PASS selection {theme}: Circle something else replaces rings; tiny redraw retained; redraw resets arrow; Escape keeps draft')

    page.get_by_role('button',name='Clear all',exact=True).click()
    select_cards(page)
    expect(page.locator('.pin-editor > .pin-heading')).to_have_text('3 elements selected')
    expect(page.locator('.pin-selection-number')).to_have_text(['1','2','3'])
    page.locator('.kpi').nth(2).click(position={'x':12,'y':12},modifiers=['Shift'])
    expect(page.locator('.pin-selection')).to_have_count(2)
    page.locator('.kpi').nth(2).click(position={'x':12,'y':12},modifiers=['Shift'])
    page.locator('.pin-comment').fill('Move these cards together')
    page.locator('.pin-editor').get_by_role('button',name='Save',exact=True).click()
    expect(page.locator('.pin-card')).to_have_count(1)
    assert len(saved(page)[0]['additionalElements']) == 2
    report = copy(page)
    for label in ['Revenue','Orders','Average order']:
        assert label in report
    for element in [saved(page)[0]['element'],*saved(page)[0]['additionalElements']]:
        assert element['selector'] in report
        assert element['selector'] not in page.locator('.pin-card').inner_text()
    page.reload();page.locator('.pin-toggle').click()
    expect(page.locator('.pin-marker-dot')).to_have_count(3)
    page.locator('.pin-card').click()
    expect(page.locator('.pin-editor > .pin-heading')).to_have_text('3 elements selected')
    expect(page.locator('.pin-selection')).to_have_count(3)
    page.locator('.pin-editor').get_by_role('button',name='Cancel',exact=True).click()
    print(f'PASS selection {theme}: Shift start/add/remove, numbered selections, one note, every selector in Copy all, no on-screen selectors, reload')

    select_cards(page)
    prompt=annotate(page)
    expect(page.locator('[data-draft] rect')).to_have_count(3)
    expect(prompt.locator('.pin-circle-step')).to_have_text('✓ 3 elements selected')
    arrow(page,multi=True);save(page,2)
    assert len(saved(page)[1]['annotation']['rings']) == 3
    assert len(saved(page)[1]['additionalElements']) == 2
    expect(page.locator('[data-note-id] .pin-annotation-stroke')).to_have_count(1)
    page.reload();page.locator('.pin-toggle').click()
    expect(page.locator('[data-note-id] rect')).to_have_count(3)
    expect(page.locator('.pin-annotation-dot text')).to_have_text(['2','2','2'])
    page.locator('.pin-card').nth(1).click()
    page.locator('.kpi').first.click(position={'x':12,'y':12},modifiers=['Shift'])
    page.keyboard.press('Escape')
    page.locator('.pin-card').nth(1).click()
    expect(page.locator('.pin-editor > .pin-heading')).to_have_text('2 elements selected')
    page.locator('.pin-editor').get_by_role('button',name='Save',exact=True).click()
    updated=saved(page)[1]
    assert updated['element']['displayedValue'].startswith('Orders')
    assert len(updated['additionalElements']) == 1
    assert 'annotation' not in updated
    print(f'PASS selection {theme}: editing selection updates primary and additional elements; Escape retains selection draft; obsolete marks cleared on Save')
    source.click()
    expect(page.locator('.pin-selection')).to_have_count(1)
    expect(page.locator('.pin-editor > .pin-heading')).to_have_text('New feedback')
    page.locator('.pin-editor').get_by_role('button',name='Cancel',exact=True).click()
    page.locator('.kpi').first.click(position={'x':12,'y':12},modifiers=['Shift'])
    page.locator('.kpi').first.click(position={'x':12,'y':12},modifiers=['Shift'])
    expect(page.locator('.pin-editor')).to_be_hidden()
    assert len(saved(page)) == 2
    print(f'PASS selection {theme}: multi-ring single-arrow persisted note; numbered dots; plain click stays single; empty selection closes editor')

    legacy=saved(page)[1]
    legacy.pop('additionalElements')
    legacy['annotation']={'mark':'Highlight','circle':{'x':250,'y':130,'width':100,'height':60},'stroke':None}
    page.evaluate('note=>localStorage.setItem("pin-overlay:"+location.href,JSON.stringify([note]))',legacy)
    page.reload();page.locator('.pin-toggle').click()
    expect(page.locator('[data-note-id] ellipse')).to_have_count(1)
    assert saved(page)[0]['annotation']['circle']['width'] == 100
    legacy['annotation']={'mark':'Move','rings':[{'x':0,'y':0,'width':'bad','height':10}],'stroke':None}
    legacy['additionalElements']=[{'selector':42}]
    page.evaluate('note=>localStorage.setItem("pin-overlay:"+location.href,JSON.stringify([note]))',legacy)
    page.reload();page.locator('.pin-toggle').click()
    expect(page.locator('.pin-card')).to_have_count(1)
    expect(page.locator('[data-note-id]')).to_have_count(0)
    assert 'Element 2' not in copy(page)
    assert not errors, errors
    print(f'PASS selection {theme}: legacy manual-circle notes render; invalid rings/additional elements safely ignored; no page errors')
    ctx.close()


def phone_checks(browser,url,theme):
    ctx=browser.new_context(viewport={'width':390,'height':844},has_touch=True,color_scheme=theme,
                            ignore_https_errors=True,permissions=['clipboard-read','clipboard-write'])
    page=ctx.new_page()
    page.add_init_script("localStorage.setItem('demo:intro-hidden','1')")
    page.goto(url);page.add_style_tag(content=DARK)
    page.locator('.pin-toggle').tap()
    source=page.locator('.kpi-value').first
    source.tap();prompt=annotate(page)
    expect(page.locator('[data-draft] rect')).to_have_count(1)
    expect(prompt.locator('.pin-circle-step')).to_have_text('✓ Circle')
    expect(page.locator('.pin-selection-hint')).to_be_hidden()
    assert not overlaps(prompt.bounding_box(),page.locator('[data-draft] rect').bounding_box())
    a,b=source.bounding_box(),page.locator('.kpi-value').nth(1).bounding_box()
    touch_drag(page,(a['x']+a['width']/2,a['y']+a['height']/2,b['x']+b['width']/2,b['y']+b['height']/2))
    save(page,1)
    assert 'to “1,284”' in copy(page)
    page.wait_for_timeout(800)  # Chrome swallows taps immediately after a CDP touch drag.
    for count,mark in enumerate(['Remove','Highlight'],2):
        source.tap();prompt=annotate(page,mark)
        save(page,count)
        assert saved(page)[-1]['annotation']['stroke'] is None
    source.tap()
    page.locator('.kpi-value').nth(1).click(modifiers=['Shift'])
    expect(page.locator('.pin-selection')).to_have_count(1)
    expect(page.locator('.pin-editor > .pin-heading')).to_have_text('New feedback')
    print(f'PASS selection phone {theme}: compact default ring, touch arrow-only KPI Move, immediate Remove/Highlight, no Shift multi-selection')
    ctx.close()


def evidence(browser, main_url, branch_url, theme):
    for state in 'abcd':
        for label,url in [('main',main_url),('branch',branch_url)]:
            ctx,page,errors=start(browser,url,theme)
            if state in 'cd':
                if label=='branch':select_cards(page)
                else:page.locator('.kpi').first.click(position={'x':12,'y':12})
            else:page.get_by_role('button',name='Export CSV',exact=True).click()
            if state!='c':
                annotate(page)
                if state in 'bd':
                    if label=='main':
                        source=page.locator('.kpi').first if state=='d' else page.get_by_role('button',name='Export CSV',exact=True)
                        r=source.bounding_box()
                        drag(page,(r['x']-6,r['y']-6),(r['x']+r['width']+6,r['y']+r['height']+6))
                    arrow(page,multi=state=='d' and label=='branch',kpi=state=='d')
                if state in 'bd':expect(page.locator('.pin-annotation-prompt .pin-button-primary')).to_be_enabled()
            page.mouse.move(10,980)
            page.screenshot(path=str(OUT/f'{theme}-{state}-{label}.png'),animations='disabled')
            assert not errors,errors
            ctx.close()
        left,right=[Image.open(OUT/f'{theme}-{state}-{label}.png').convert('RGB') for label in ['main','branch']]
        w,h=left.size
        result=Image.new('RGB',(w*2+4,h+80),'#14161a' if theme=='dark' else '#edf0f5')
        draw=ImageDraw.Draw(result);font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',30)
        for x,img,text in [(0,left,'Before — main'),(w+4,right,'After — branch')]:
            result.paste(img,(x,80));draw.text((x+30,20),text,font=font,fill='white' if theme=='dark' else '#191919')
        result.save(OUT/f'{theme}-{state}.png')
        print(f'PASS evidence {theme}-{state}.png: main left, branch right, matching page and state')


if __name__=='__main__':
    OUT.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as pw,serve() as url,serve(main=True) as main_url:
        browser=pw.chromium.launch(executable_path=CHROME,args=['--no-sandbox'])
        for theme in ['light','dark']:
            checks(browser,url,theme)
            phone_checks(browser,url,theme)
            if '--evidence' in sys.argv:evidence(browser,main_url,url,theme)
        browser.close()
