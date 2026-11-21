"""Touch regressions and main/branch evidence: python3 tests/mobile_annotations.py.

Requires Playwright, Pillow and Chromium (CHROME may override the executable).
Use --baseline before fixing to assert all three reported failures on main.
"""
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import json
import mimetypes
import os
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = Path.home() / 'annotation-evidence' / 'mobile'
CHROME = os.environ.get('CHROME', str(Path.home() / '.cache/ms-playwright/chromium-1248/chrome-linux64/chrome'))
DESCRIPTION = 'add a button that collapses and expands this section'


@contextmanager
def serve(main=False):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            path = self.path.split('?')[0]
            name = path.removeprefix('/ui-editor/') if path.startswith('/ui-editor/') else 'demo/' + path.lstrip('/')
            if name.endswith('/'):
                name += 'index.html'
            try:
                data = subprocess.check_output(['git', 'show', f'origin/main:{name}'], cwd=ROOT, stderr=subprocess.DEVNULL) if main else (ROOT / name).read_bytes()
            except (OSError, subprocess.CalledProcessError):
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header('Content-Type', mimetypes.guess_type(name)[0] or 'application/octet-stream')
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *_):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f'http://localhost:{server.server_port}/?pin=1'
    finally:
        server.shutdown()
        thread.join()
        server.server_close()


def touch_drag(page, bounds):
    x1, y1, x2, y2 = bounds
    session = page.context.new_cdp_session(page)
    session.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x1, 'y': y1}]})
    for step in range(1, 13):
        session.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [
            {'x': x1 + (x2 - x1) * step / 12, 'y': y1 + (y2 - y1) * step / 12}]})
    session.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    session.detach()


def overlaps(a, b):
    return a['x'] < b['x'] + b['width'] and a['x'] + a['width'] > b['x'] and a['y'] < b['y'] + b['height'] and a['y'] + a['height'] > b['y']


def extra_checks(page, theme):
    page.locator('.pin-editor').get_by_role('button', name='Cancel', exact=True).click()
    page.get_by_role('button', name='Clear all', exact=True).click()
    cases = [('label', '.kpi-label', 1, 'span'), ('heading', 'h1', 0, 'h1'),
             ('card', '.kpi', 1, 'article'), ('empty container', '.topbar-actions button', 1, 'button'),
             ('outside viewport', '.kpi-value', 1, None)]
    for name, selector, index, expected_tag in cases:
        page.evaluate('window.scrollTo(0, 0)')
        source = page.locator('.kpi-value').first
        source.click()
        page.get_by_role('button', name='Annotate', exact=True).click()
        a = source.bounding_box()
        touch_drag(page, (a['x'] - 3, a['y'] - 5, a['x'] + a['width'] + 3, a['y'] + a['height'] + 5))
        b = page.locator(selector).nth(index).bounding_box()
        x, y = b['x'] + b['width'] / 2, b['y'] + b['height'] / 2
        if name == 'card':
            x, y = b['x'] + 4, b['y'] + b['height'] - 4
        elif name == 'empty container':
            x = b['x'] + b['width'] + 10
        elif name == 'outside viewport':
            x = -12
        touch_drag(page, (a['x'] + a['width'] / 2, a['y'] + a['height'] / 2, x, y))
        page.locator('.pin-annotation-prompt').get_by_role('button', name='Save', exact=True).click()
        expect(page.locator('.pin-card')).to_have_count(1)
        destination = page.evaluate("JSON.parse(localStorage.getItem('pin-overlay:'+location.href))[0].annotation.destination")
        assert (destination['element']['tag'] if destination else None) == expected_tag, (name, destination)
        page.get_by_role('button', name='Clear all', exact=True).click()
    source.click()
    page.get_by_role('button', name='Annotate', exact=True).click()
    a = source.bounding_box()
    touch_drag(page, (a['x'], a['y'], a['x'] + 1, a['y'] + 1))
    expect(page.locator('.pin-annotation-prompt').get_by_role('button', name='Save', exact=True)).to_be_disabled()
    page.keyboard.press('Escape')
    expect(page.locator('.pin-editor')).to_be_visible()
    print(f'PASS mobile {theme}: exact label/heading/card hits, empty-container control fallback, offscreen destination, tiny drag and Escape', flush=True)
    page.locator('.pin-editor').get_by_role('button', name='Cancel', exact=True).click()
    source.click()
    page.get_by_role('button', name='Annotate', exact=True).click()
    prompt = page.locator('.pin-annotation-prompt')
    touch_drag(page, (30, 700, 200, 790))
    assert 'pin-annotation-bottom' not in prompt.get_attribute('class')
    assert not overlaps(prompt.bounding_box(), page.locator('[data-draft] ellipse').bounding_box())
    touch_drag(page, (100, 124, 200, 820))
    assert 'pin-annotation-bottom' not in prompt.get_attribute('class'), 'Both positions overlap: default to top'
    page.keyboard.press('Escape')
    print(f'PASS mobile {theme}: bottom mark keeps prompt on top; both positions overlapping defaults to top', flush=True)


def run(browser, url, version, theme, baseline=False):
    context = browser.new_context(viewport={'width': 390, 'height': 844}, has_touch=True,
                                  device_scale_factor=2, color_scheme=theme,
                                  permissions=['clipboard-read', 'clipboard-write'])
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
    page.add_init_script("localStorage.setItem('demo:intro-hidden', '1')")
    page.goto(url)
    page.add_style_tag(content='''@media(prefers-color-scheme:dark){:root{
        --bg:#111317;--surface:#1b1e23;--text:#f1f3f6;--text-muted:#a9b0bc;
        --border:rgba(255,255,255,.12);--good:#76d7a4;--bad:#ff9388;
        --warn:#f0bc69;--accent:#6aa6ff}}''')
    page.evaluate('document.fonts.ready')
    page.locator('.pin-toggle').tap()
    source = page.locator('.kpi-value').nth(0)
    target = page.locator('.kpi-value').nth(1)
    source.tap()
    page.get_by_role('button', name='Annotate', exact=True).tap()
    box = source.bounding_box()
    initial_scroll = page.evaluate('scrollY')
    touch_drag(page, (box['x'] - 3, box['y'] - 5, box['x'] + box['width'] + 3, box['y'] + box['height'] + 5))
    expect(page.locator('[data-draft] ellipse')).to_have_count(1)
    prompt = page.locator('.pin-annotation-prompt')
    height = prompt.bounding_box()['height']
    compact = height <= 110
    separator = page.locator('.pin-step-divider').is_visible()
    # Scroll the circle under the original top prompt: collision docking must react.
    page.evaluate('window.scrollBy(0, 90)')
    page.wait_for_function('scrollY > 0')
    page.wait_for_timeout(100)
    collision_free = not overlaps(prompt.bounding_box(), page.locator('[data-draft] ellipse').bounding_box())
    page.screenshot(path=str(OUT / f'{theme}-{version}-prompt.png'))
    # Return to the reported KPI-to-KPI geometry; do not let the prompt change the hit.
    page.evaluate('(y) => window.scrollTo(0, y)', initial_scroll)
    page.wait_for_timeout(100)
    a, b = source.bounding_box(), target.bounding_box()
    endpoint = (b['x'] + b['width'] / 2, b['y'] + b['height'] / 2)
    hit = page.evaluate('''([x,y]) => document.elementsFromPoint(x,y).find(el => !el.closest('#pin-root')).outerHTML''', endpoint)
    touch_drag(page, (a['x'] + a['width'] - 4, a['y'] + a['height'] / 2, *endpoint))
    expect(page.locator('.pin-annotation-prompt').get_by_role('button', name='Save', exact=True)).to_be_enabled()
    page.locator('.pin-annotation-prompt').get_by_role('button', name='Save', exact=True).click()
    expect(page.locator('.pin-card')).to_have_count(1)
    page.get_by_role('button', name='Copy all', exact=True).tap()
    report = page.evaluate('navigator.clipboard.readText()')
    pins = page.evaluate("JSON.parse(localStorage.getItem('pin-overlay:' + location.href))")
    destination = pins[0]['annotation']['destination']
    correct_destination = destination['element']['displayedValue'] == '1,284'
    if not baseline:
        detail_line = next(line for line in report.splitlines() if line.startswith('- Move:'))
        assert ' to “1,284” (' in detail_line and ' on “1,284”' not in detail_line, detail_line
        print(f'PASS mobile {theme}: direct-hit Copy all uses to “1,284”', flush=True)
    print(f'{version} {theme} destination: hit={hit}; saved={destination["relation"]}; selector={destination["element"]["selector"]}', flush=True)
    # Show the real clipboard text in a plain, wrapping report surface for evidence.
    with page.expect_popup() as popup:
        page.evaluate("window.open('about:blank')")
    report_page = popup.value
    report_page.set_content('<meta name="viewport" content="width=device-width"><h2>Copy all — KPI Move</h2><pre></pre>')
    report_page.locator('pre').evaluate('(el,text) => el.textContent=text', report)
    report_page.add_style_tag(content=f'body{{margin:20px;font:14px/1.6 system-ui;background:{"#111317" if theme == "dark" else "#fff"};color:{"#f1f3f6" if theme == "dark" else "#191919"}}}pre{{font:13px/1.6 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere}}')
    report_page.screenshot(path=str(OUT / f'{theme}-{version}-report.png'))
    report_page.close()
    page.locator('.pin-card').tap()
    chip = page.get_by_role('button', name='Add collapse button', exact=True)
    chip.tap()
    describedby = chip.get_attribute('aria-describedby')
    caption_visible = bool(describedby) and page.locator(f'#{describedby}').is_visible()
    if caption_visible:
        expect(page.locator(f'#{describedby}')).to_have_text(DESCRIPTION[0].upper() + DESCRIPTION[1:])
    page.wait_for_timeout(350)  # Let Chrome's transient tap highlight fade before capture.
    page.screenshot(path=str(OUT / f'{theme}-{version}-caption.png'))
    print(f'{version} {theme} prompt: height={height}; compact={compact}; separator={separator}; scroll collision-free={collision_free}', flush=True)
    print(f'{version} {theme} caption: visible={caption_visible}; aria-describedby={describedby}', flush=True)
    results = {'KPI destination': correct_destination, 'compact collision-free prompt': compact and not separator and collision_free, 'touch action caption': caption_visible}
    if baseline:
        for name, result in results.items():
            assert not result, f'Expected failing repro for {name}'
            print(f'REPRO {version} {theme}: FAIL {name}', flush=True)
    else:
        for name, result in results.items():
            assert result, f'{name}: {json.dumps(destination)}'
            print(f'PASS mobile {theme}: {name}', flush=True)
        expect(chip).to_have_attribute('title', 'Add collapse button (' + DESCRIPTION + ')')
        assert chip.evaluate("el => getComputedStyle(el).userSelect") == 'none'
        chip.focus()
        page.keyboard.press('Enter')
        expect(page.locator(f'#{describedby}')).to_be_hidden()
        page.keyboard.press('Enter')
        expect(page.locator(f'#{describedby}')).to_be_visible()
        page.get_by_role('button', name='Standardise fonts', exact=True).tap()
        expect(page.locator(f'#{describedby}')).to_have_text('Max 3 font sizes')
        page.get_by_role('button', name='Remove', exact=True).tap()
        expect(page.locator(f'#{describedby}')).to_be_hidden()
        print(f'PASS mobile {theme}: keyboard toggles caption, other descriptions, no-description action and touch selection prevention', flush=True)
        extra_checks(page, theme)
    assert not errors, errors
    context.close()


def compare(theme, kind):
    shots = [Image.open(OUT / f'{theme}-{version}-{kind}.png').convert('RGB') for version in ['main', 'branch']]
    image = Image.new('RGB', (1564, 1736), '#15171b' if theme == 'dark' else '#edf0f5')
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 22)
    for x, shot, label in zip([0, 784], shots, ['Before — main', 'After — branch']):
        image.paste(shot, (x, 48))
        draw.text((x + 18, 10), label, font=font, fill='white' if theme == 'dark' else 'black')
    image.save(OUT / f'{theme}-{kind}-comparison.png')


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw, serve(main=True) as main_url, serve() as branch_url:
        browser = pw.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
        for theme in ['light', 'dark']:
            run(browser, main_url, 'main', theme, baseline=True)
            if '--baseline' not in sys.argv:
                run(browser, branch_url, 'branch', theme)
                for kind in ['prompt', 'caption', 'report']:
                    compare(theme, kind)
        browser.close()
