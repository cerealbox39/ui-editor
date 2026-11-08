(() => {
  'use strict';
  if (new URLSearchParams(location.search).get('pin') !== '1' || document.getElementById('pin-root')) return;

  const issueTypes = ['UI/UX', 'Incorrect data', 'Missing data', 'Broken behavior', 'Suggestion'];
  const uiIntents = ['Move', 'Resize', 'Recolour', 'Alignment', 'Text', 'Remove', 'Other'];
  const pageURL = location.href;
  const storageKey = `pin-overlay:${pageURL}`;
  let pins = [], active = false, autoCopy = true, target = null, editing = null;

  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (Array.isArray(stored)) pins = stored.filter(pin => pin?.element && typeof pin.comment === 'string').map(pin => ({
      ...pin, issueType: issueTypes.includes(pin.issueType) ? pin.issueType : 'UI/UX', uiIntent: pin.uiIntent || pin.intent || 'Other',
      expected: pin.expected || '', correctValue: pin.correctValue || '', dataSource: pin.dataSource || '', steps: pin.steps || '', screenshotReference: pin.screenshotReference || '',
    }));
  } catch (_) { /* Storage may be unavailable. */ }

  const root = document.createElement('div'); root.id = 'pin-root';
  const make = (tag, cls, text, parent = root) => {
    const element = document.createElement(tag); element.className = `pin-${cls}`;
    if (text !== undefined) element.textContent = text;
    parent.append(element); return element;
  };
  const button = (text, parent, handler) => {
    const element = make('button', 'button', text, parent); element.type = 'button'; element.addEventListener('click', handler); return element;
  };
  const field = (label, control) => {
    const wrapper = make('label', 'field', undefined, editor); make('span', 'field-label', label, wrapper); wrapper.append(control); return wrapper;
  };
  const input = (label, placeholder) => {
    const control = make('input', 'input'); control.placeholder = placeholder; control.setAttribute('aria-label', label); return { wrapper: field(label, control), control };
  };
  const area = (label, placeholder) => {
    const control = make('textarea', 'comment'); control.placeholder = placeholder; control.setAttribute('aria-label', label); return { wrapper: field(label, control), control };
  };

  const toggle = button('◎ App feedback', root, () => setActive(!active));
  toggle.classList.add('pin-toggle'); toggle.setAttribute('aria-pressed', 'false');
  const outline = make('div', 'outline'); outline.hidden = true;
  const outlineLabel = make('div', 'label', '', outline);
  const panel = make('section', 'panel'); panel.hidden = true; panel.setAttribute('aria-label', 'Pinned app feedback');
  make('h2', 'heading', 'App feedback', panel);
  make('p', 'hint', 'Point to any UI, data value, or broken interaction. Esc exits.', panel);
  const controls = make('div', 'controls', undefined, panel);
  button('Copy all', controls, copyAll);
  button('Clear all', controls, () => { pins = []; closeEditor(); changed(); });
  const autoLabel = make('label', 'auto', undefined, panel);
  const auto = make('input', 'checkbox', undefined, autoLabel); auto.type = 'checkbox'; auto.checked = true;
  autoLabel.append(document.createTextNode(' Auto-copy (overwrites clipboard)'));
  const list = make('ol', 'list', undefined, panel);
  const status = make('p', 'status', 'Ready', panel); status.setAttribute('role', 'status');
  auto.addEventListener('change', () => { autoCopy = auto.checked; status.textContent = autoCopy ? 'Auto-copy on — changes overwrite clipboard' : 'Auto-copy off — use Copy all'; });

  const editor = make('form', 'editor'); editor.hidden = true; editor.setAttribute('aria-label', 'Edit feedback');
  const title = make('h2', 'heading', 'New feedback', editor);
  make('span', 'field-label', 'Issue type', editor);
  const typeChips = make('div', 'chips', undefined, editor);
  let issueType = 'UI/UX', uiIntent = 'Other';
  const typeButtons = issueTypes.map(value => button(value, typeChips, () => { issueType = value; refreshFields(); }));
  const intentGroup = make('div', 'conditional', undefined, editor);
  make('span', 'field-label', 'UI change', intentGroup);
  const intentChips = make('div', 'chips', undefined, intentGroup);
  const intentButtons = uiIntents.map(value => button(value, intentChips, () => { uiIntent = value; refreshFields(); }));
  const comment = area('What is wrong or should change?', 'Describe the issue in your own words.');
  const expected = area('Expected result', 'What should the app show or do instead?');
  const correctValue = input('Correct or missing value', 'For example: USD 890');
  const dataSource = input('Source or reference', 'Workbook cell, Google Sheet, URL, owner, or effective date');
  const steps = area('Steps to reproduce', 'What did you do before the problem appeared?');
  const screenshot = input('Screenshot reference', 'Optional local screenshot path or filename');
  const actions = make('div', 'controls', undefined, editor);
  const save = button('Save', actions, () => {}); save.type = 'submit';
  button('Cancel', actions, closeEditor);
  const remove = button('Delete', actions, () => { pins = pins.filter(pin => pin.id !== editing); closeEditor(); changed(); });
  document.body.append(root);

  function refreshFields() {
    typeButtons.forEach((item, index) => item.setAttribute('aria-pressed', String(issueTypes[index] === issueType)));
    intentButtons.forEach((item, index) => item.setAttribute('aria-pressed', String(uiIntents[index] === uiIntent)));
    intentGroup.hidden = issueType !== 'UI/UX';
    correctValue.wrapper.hidden = !['Incorrect data', 'Missing data'].includes(issueType);
    dataSource.wrapper.hidden = !['Incorrect data', 'Missing data'].includes(issueType);
    steps.wrapper.hidden = issueType !== 'Broken behavior';
  }

  editor.addEventListener('submit', event => {
    event.preventDefault();
    const values = { issueType, uiIntent, comment: comment.control.value, expected: expected.control.value, correctValue: correctValue.control.value, dataSource: dataSource.control.value, steps: steps.control.value, screenshotReference: screenshot.control.value };
    if (editing) Object.assign(pins.find(pin => pin.id === editing) || {}, values);
    else if (target?.isConnected) pins.push({ id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`, url: pageURL, viewport: { width: innerWidth, height: innerHeight }, timestamp: new Date().toISOString(), element: describe(target), ...values });
    closeEditor(); changed();
  });

  function count(selector) { try { return document.querySelectorAll(selector).length; } catch (_) { return 0; } }
  function selectorFor(element) {
    if (element.id) { const selector = `#${CSS.escape(element.id)}`; if (count(selector) === 1) return { selector, selectorConfidence: 'high' }; }
    if (element.hasAttribute('data-testid')) { const selector = `[data-testid="${CSS.escape(element.getAttribute('data-testid'))}"]`; if (count(selector) === 1) return { selector, selectorConfidence: 'high' }; }
    const classes = [...element.classList].slice(0, 8);
    for (let total = 1; total <= classes.length; total++) { const selector = element.localName + classes.slice(0, total).map(name => `.${CSS.escape(name)}`).join(''); if (count(selector) === 1) return { selector, selectorConfidence: 'medium' }; }
    const parts = []; let node = element;
    for (let depth = 0; node && depth < 5; depth++, node = node.parentElement) {
      const siblings = node.parentElement ? [...node.parentElement.children].filter(item => item.localName === node.localName) : [node];
      parts.unshift(`${node.localName}:nth-of-type(${siblings.indexOf(node) + 1})`);
      const selector = parts.join(' > '); if (count(selector) === 1) return { selector, selectorConfidence: depth < 2 ? 'medium' : 'low' };
    }
    return { selector: element.localName, selectorConfidence: 'low' };
  }

  const cleanText = value => String(value || '').replace(/\s+/g, ' ').trim();
  const short = value => cleanText(value).slice(0, 160);
  function controlValue(element) {
    if (element instanceof HTMLSelectElement) return element.selectedOptions[0]?.textContent || element.value;
    if (element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type)) return element.checked ? 'checked' : 'not checked';
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element.value;
    return '';
  }
  function tableContext(element) {
    const row = element.closest('tr'), table = row?.closest('table');
    if (!row || !table) return null;
    const headers = [...table.querySelectorAll('thead th')].map(header => short(header.textContent));
    return Object.fromEntries([...row.children].map((cell, index) => [headers[index] || `Column ${index + 1}`, short(cell.textContent)]));
  }
  function nearbyControls(element) {
    const container = element.closest('form, section, article, main') || document.body;
    return [...container.querySelectorAll('input, select, textarea')].slice(0, 10).map(control => ({
      label: short(control.getAttribute('aria-label') || control.closest('label')?.textContent || control.name || control.id), value: short(controlValue(control)),
    })).filter(item => item.label || item.value);
  }
  function describe(element) {
    const style = getComputedStyle(element), rect = element.getBoundingClientRect(), selector = selectorFor(element);
    return { ...selector, tag: element.localName, classes: [...element.classList], displayedValue: short(controlValue(element) || element.textContent), dataAttributes: { ...element.dataset }, parentChain: [...Array(3)].map((_, index) => { let node = element.parentElement; for (let step = 0; step < index; step++) node = node?.parentElement; return node && { tag: node.localName, classes: [...node.classList], text: short(node.textContent) }; }).filter(Boolean), computedStyles: { color: style.color, backgroundColor: style.backgroundColor, fontSize: style.fontSize, fontWeight: style.fontWeight, padding: style.padding, margin: style.margin, borderRadius: style.borderRadius, width: style.width, height: style.height }, rect: { x: rect.x, y: rect.y, top: rect.top, left: rect.left, width: rect.width, height: rect.height }, nearbyText: short(element.parentElement?.textContent), tableContext: tableContext(element), nearbyControls: nearbyControls(element) };
  }

  const elementLabel = element => `${element.tag}${element.classes[0] ? '.' + element.classes[0] : element.displayedValue ? ' ' + element.displayedValue : ''}`.trim();
  const inline = value => String(value || '').replace(/\s+/g, ' ').replace(/[\\`*_\[\]<>]/g, '\\$&');
  const present = value => String(value || '').trim();
  function markdown() {
    const lines = [`## App feedback — ${pins.length} ${pins.length === 1 ? 'item' : 'items'}`, `- Page: ${pageURL}`];
    pins.forEach((pin, index) => {
      const element = pin.element;
      const kind = pin.issueType === 'UI/UX' ? `${pin.issueType} / ${pin.uiIntent}` : pin.issueType;
      lines.push('', `### ${index + 1}. [${kind}] ${inline(elementLabel(element))}`, `- Selector: \`${element.selector.replace(/`/g, '\\`')}\` (${element.selectorConfidence} confidence)`);
      if (present(element.displayedValue)) lines.push(`- Text/value: ${inline(element.displayedValue)}`);
      if (present(pin.comment)) lines.push(`- Request: ${inline(pin.comment)}`);
      if (present(pin.expected)) lines.push(`- Expected: ${inline(pin.expected)}`);
      if (['Incorrect data', 'Missing data'].includes(pin.issueType)) {
        if (present(pin.correctValue)) lines.push(`- Correct/missing value: ${inline(pin.correctValue)}`);
        if (present(pin.dataSource)) lines.push(`- Source: ${inline(pin.dataSource)}`);
        if (element.tableContext) lines.push(`- Row: ${inline(Object.entries(element.tableContext).map(([key, value]) => `${key}: ${value}`).join('; '))}`);
      }
      if (pin.issueType === 'Broken behavior' && present(pin.steps)) lines.push(`- Steps: ${inline(pin.steps)}`);
      if (present(pin.screenshotReference)) lines.push(`- Screenshot: ${inline(pin.screenshotReference)}`);
      if (element.selectorConfidence === 'low') {
        const parent = element.parentChain?.[0];
        if (parent) lines.push(`- Parent: ${inline(`${parent.tag}${parent.classes?.[0] ? `.${parent.classes[0]}` : ''}`)}`);
        if (present(element.nearbyText) && element.nearbyText !== element.displayedValue) lines.push(`- Nearby: ${inline(element.nearbyText)}`);
      }
    });
    return lines.join('\n');
  }

  let copySequence = 0, copyQueue = Promise.resolve();
  function copyAll() {
    const output = markdown(), total = pins.length, sequence = ++copySequence;
    const write = () => navigator.clipboard?.writeText ? navigator.clipboard.writeText(output) : Promise.reject(new Error('Clipboard API unavailable'));
    const promise = write();
    copyQueue = copyQueue.catch(() => {}).then(() => promise).then(() => { if (sequence === copySequence) status.textContent = `Clipboard updated — ${total} items ready to paste`; }).catch(error => { if (sequence === copySequence) status.textContent = 'Clipboard update failed — use Copy all'; console.warn('App feedback overlay: clipboard update failed', error); });
  }
  function changed() {
    try { if (pins.length) localStorage.setItem(storageKey, JSON.stringify(pins)); else localStorage.removeItem(storageKey); } catch (_) { status.textContent = 'Storage unavailable — feedback remains in memory'; }
    render(); if (autoCopy) copyAll();
  }
  function render() {
    list.replaceChildren();
    pins.forEach((pin, index) => { const item = make('li', 'item', undefined, list); button(`${index + 1}. ${elementLabel(pin.element)} · ${pin.issueType}\n${short(pin.comment)}`, item, () => openEditor(null, pin)); });
    if (!pins.length) make('li', 'empty', 'No feedback yet', list);
  }
  function closeEditor() { editor.hidden = true; target = null; editing = null; outline.hidden = true; }
  function placeEditor(rect) {
    const edge = 12, viewportGap = 8, width = editor.getBoundingClientRect().width;
    editor.style.width = ''; editor.style.maxHeight = `${innerHeight - (viewportGap * 2)}px`;
    if (!rect) { editor.style.left = `${innerWidth - width - 24}px`; editor.style.top = '24px'; return; }
    const horizontalTop = Math.max(viewportGap, Math.min(rect.top, innerHeight - editor.offsetHeight - viewportGap));
    const placements = [
      { room: innerWidth - rect.right - edge, fit: innerWidth - rect.right - edge >= width, left: rect.right + edge, top: horizontalTop, maxHeight: innerHeight - (viewportGap * 2) },
      { room: rect.left - edge, fit: rect.left - edge >= width, left: rect.left - width - edge, top: horizontalTop, maxHeight: innerHeight - (viewportGap * 2) },
      { room: innerHeight - rect.bottom - edge, fit: innerHeight - rect.bottom - edge >= 280, left: Math.max(viewportGap, Math.min(rect.left, innerWidth - width - viewportGap)), top: rect.bottom + edge, maxHeight: innerHeight - rect.bottom - edge - viewportGap },
      { room: rect.top - edge, fit: rect.top - edge >= 280, left: Math.max(viewportGap, Math.min(rect.left, innerWidth - width - viewportGap)), top: viewportGap, maxHeight: rect.top - edge - viewportGap },
    ];
    const placement = placements.filter(option => option.fit).sort((left, right) => right.room - left.room)[0] || placements.sort((left, right) => right.room - left.room)[0];
    editor.style.left = `${placement.left}px`; editor.style.top = `${placement.top}px`; editor.style.maxHeight = `${Math.max(280, placement.maxHeight)}px`;
  }
  function openEditor(element, pin) {
    target = element; editing = pin?.id || null; issueType = pin?.issueType || 'UI/UX'; uiIntent = pin?.uiIntent || 'Other';
    comment.control.value = pin?.comment || ''; expected.control.value = pin?.expected || ''; correctValue.control.value = pin?.correctValue || ''; dataSource.control.value = pin?.dataSource || ''; steps.control.value = pin?.steps || ''; screenshot.control.value = pin?.screenshotReference || ''; remove.hidden = !pin;
    title.textContent = pin ? 'Edit feedback' : 'New feedback'; refreshFields(); editor.hidden = false;
    placeEditor(element?.getBoundingClientRect()); comment.control.focus();
  }
  function hover(event) {
    if (!active || !editor.hidden || root.contains(event.target) || !(event.target instanceof Element)) return;
    const rect = event.target.getBoundingClientRect(); outline.hidden = false; Object.assign(outline.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` }); outlineLabel.textContent = `${event.target.localName}${event.target.classList[0] ? '.' + event.target.classList[0] : ' ' + short(event.target.textContent)}`;
  }
  function intercept(event) { if (!active || root.contains(event.target)) return; event.preventDefault(); event.stopImmediatePropagation(); if (event.type === 'click') openEditor(event.target); }
  function setActive(value) {
    active = value; panel.hidden = !value; toggle.setAttribute('aria-pressed', String(value)); toggle.textContent = value ? '◎ Exit inspect' : '◎ App feedback'; closeEditor();
    const method = value ? 'addEventListener' : 'removeEventListener'; window[method]('pointermove', hover, true);
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu']) window[method](type, intercept, true);
  }
  document.addEventListener('keydown', event => { if (event.altKey && event.shiftKey && event.code === 'KeyP') { event.preventDefault(); setActive(!active); } else if (event.key === 'Escape' && active) { event.preventDefault(); setActive(false); } });
  window.addEventListener('scroll', () => { outline.hidden = true; }, true); window.addEventListener('resize', () => { outline.hidden = true; }); render();
})();
