(() => {
  'use strict';
  if (new URLSearchParams(location.search).get('pin') !== '1' || document.getElementById('pin-root')) return;

  const issueTypes = ['UI/UX', 'Data', 'New Feature'];
  const uiActions = ['Remove', 'Bold', 'Reduce font', 'Increase font', 'Standardise (max 3 font sizes)'];
  const pageURL = location.href;
  const storageKey = `pin-overlay:${pageURL}`;
  let pins = [], active = false, autoCopy = true, target = null, editing = null;
  const drafts = new Map();

  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || '[]');
    let migrateStorage = false;
    const legacyFields = ['expected', 'correctValue', 'dataSource', 'steps', 'screenshotReference', 'uiIntent', 'intent'];
    const legacyTypes = { 'Incorrect data': 'Data', 'Missing data': 'Data', Suggestion: 'New Feature', 'Broken behavior': 'UI/UX' };
    const valueText = value => typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
    if (Array.isArray(stored)) pins = stored.filter(pin => pin && typeof pin === 'object' && pin.element).map(pin => {
      const oldType = valueText(pin.issueType), issueType = issueTypes.includes(oldType) ? oldType : legacyTypes[oldType] || 'UI/UX';
      const comment = valueText(pin.comment), additions = [];
      const addLine = (label, value) => { const text = valueText(value); if (text) additions.push(`${label}: ${text}`); };
      addLine('Expected result', pin.expected); addLine('Correct or missing value', pin.correctValue);
      addLine('Source or reference', pin.dataSource); addLine('Steps to reproduce', pin.steps);
      addLine('Screenshot reference', pin.screenshotReference);
      [...new Set([valueText(pin.uiIntent), valueText(pin.intent)].filter(Boolean))].forEach(value => addLine('Previous UI intent', value));
      if (oldType && !issueTypes.includes(oldType) && !legacyTypes[oldType]) addLine('Previous issue type', oldType);
      const migratedComment = [comment, ...additions].filter(Boolean).join('\n');
      if (legacyFields.some(key => Object.hasOwn(pin, key)) || !issueTypes.includes(oldType) || typeof pin.comment !== 'string') migrateStorage = true;
      const migrated = { ...pin, issueType, uiAction: issueType === 'UI/UX' && uiActions.includes(pin.uiAction) ? pin.uiAction : '', comment: migratedComment };
      legacyFields.forEach(key => { delete migrated[key]; });
      return migrated;
    });
    if (migrateStorage) localStorage.setItem(storageKey, JSON.stringify(pins));
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
  const area = (label, placeholder) => {
    const control = make('textarea', 'comment'); control.placeholder = placeholder; control.setAttribute('aria-label', label); return { wrapper: field(label, control), control };
  };

  const toggle = button('◎ App feedback', root, () => setActive(!active));
  toggle.classList.add('pin-toggle'); toggle.setAttribute('aria-pressed', 'false');
  const outline = make('div', 'outline'); outline.hidden = true;
  const outlineLabel = make('div', 'label', '', outline);
  const panel = make('section', 'panel'); panel.hidden = true; panel.setAttribute('aria-label', 'Pinned app feedback');
  make('h2', 'heading', 'App feedback', panel);
  make('p', 'hint', 'Point to any UI, data value, or feature. Esc exits.', panel);
  const controls = make('div', 'controls', undefined, panel);
  button('Copy all', controls, copyAll);
  button('Clear all', controls, () => { pins = []; drafts.clear(); closeEditor(); changed(); });
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
  let issueType = 'UI/UX', uiAction = '';
  const typeButtons = issueTypes.map(value => button(value, typeChips, () => { issueType = value; refreshFields(); }));
  const intentGroup = make('div', 'quick-actions', undefined, editor);
  make('span', 'field-label', 'UI Quick Actions', intentGroup);
  const intentChips = make('div', 'chips', undefined, intentGroup);
  const intentButtons = uiActions.map(value => button(value, intentChips, () => { uiAction = uiAction === value ? '' : value; refreshFields(); }));
  const comment = area('Comments', 'Describe the issue or requested change.');
  const actions = make('div', 'controls', undefined, editor);
  const save = button('Save', actions, () => {}); save.type = 'submit';
  button('Cancel', actions, closeEditor);
  const remove = button('Delete', actions, () => { pins = pins.filter(pin => pin.id !== editing); closeEditor(); changed(); });
  document.body.append(root);

  function refreshFields() {
    typeButtons.forEach((item, index) => item.setAttribute('aria-pressed', String(issueTypes[index] === issueType)));
    intentButtons.forEach((item, index) => item.setAttribute('aria-pressed', String(uiActions[index] === uiAction)));
    intentGroup.hidden = issueType !== 'UI/UX';
  }

  editor.addEventListener('submit', event => {
    event.preventDefault();
    const values = { issueType, uiAction: issueType === 'UI/UX' ? uiAction : '', comment: comment.control.value };
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
  function describe(element) {
    const selector = selectorFor(element), parent = element.parentElement;
    return { ...selector, tag: element.localName, classes: [...element.classList], displayedValue: short(controlValue(element) || element.textContent), tableContext: tableContext(element), ...(selector.selectorConfidence === 'low' ? { parentChain: parent ? [{ tag: parent.localName, classes: [...parent.classList] }] : [], nearbyText: short(parent?.textContent) } : {}) };
  }

  const elementLabel = element => `${element.tag}${element.classes[0] ? '.' + element.classes[0] : element.displayedValue ? ' ' + element.displayedValue : ''}`.trim();
  const inline = value => String(value || '').replace(/\s+/g, ' ').replace(/[\\`*_\[\]<>]/g, '\\$&');
  const present = value => String(value || '').trim();
  function markdown() {
    const lines = [`## App feedback — ${pins.length} ${pins.length === 1 ? 'item' : 'items'}`, `- Page: ${pageURL}`];
    pins.forEach((pin, index) => {
      const element = pin.element;
      const kind = pin.issueType === 'UI/UX' && pin.uiAction ? `${pin.issueType} / ${pin.uiAction}` : pin.issueType;
      lines.push('', `### ${index + 1}. [${kind}] ${inline(elementLabel(element))}`, `- Selector: \`${element.selector.replace(/`/g, '\\`')}\` (${element.selectorConfidence} confidence)`);
      if (present(element.displayedValue)) lines.push(`- Text/value: ${inline(element.displayedValue)}`);
      if (present(pin.comment)) lines.push(`- Request: ${inline(pin.comment)}`);
      if (['Data', 'New Feature'].includes(pin.issueType) && element.tableContext) lines.push(`- Row: ${inline(Object.entries(element.tableContext).map(([key, value]) => `${key}: ${value}`).join('; '))}`);
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
  const listItems = new Map();
  function render() {
    const current = new Set(pins);
    listItems.forEach((item, pin) => { if (!current.has(pin)) { item.remove(); listItems.delete(pin); } });
    if (pins.length) list.querySelector('.pin-empty')?.remove();
    pins.forEach((pin, index) => {
      let item = listItems.get(pin);
      if (!item) {
        item = make('li', 'item', undefined, list);
        button('', item, () => openEditor(null, pin)); listItems.set(pin, item);
      }
      const label = `${index + 1}. ${elementLabel(pin.element)} · ${pin.issueType}\n${short(pin.comment)}`;
      if (item.firstChild.textContent !== label) item.firstChild.textContent = label;
    });
    if (!pins.length && !list.firstChild) make('li', 'empty', 'No feedback yet', list);
  }
  function closeEditor() { editor.hidden = true; target = null; editing = null; resetHover(); }
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
    const key = pin?.id || element, values = drafts.get(key) || pin;
    drafts.delete(key);
    target = element; editing = pin?.id || null; issueType = issueTypes.includes(values?.issueType) ? values.issueType : 'UI/UX'; uiAction = issueType === 'UI/UX' && uiActions.includes(values?.uiAction) ? values.uiAction : '';
    comment.control.value = values?.comment || ''; remove.hidden = !pin;
    title.textContent = pin ? 'Edit feedback' : 'New feedback'; refreshFields(); editor.hidden = false;
    placeEditor(element?.getBoundingClientRect()); comment.control.focus();
  }
  let hoverFrame = null, hoverTarget = null, hoverLabel = null, hoverStyle = {};
  function resetHover() {
    if (hoverFrame !== null) cancelAnimationFrame(hoverFrame);
    hoverFrame = null; hoverTarget = null; hoverLabel = null; hoverStyle = {}; outline.hidden = true;
  }
  function renderHover() {
    hoverFrame = null;
    const element = hoverTarget; hoverTarget = null;
    if (!active || !editor.hidden || !element?.isConnected) return;
    const rect = element.getBoundingClientRect();
    const style = { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` };
    const label = `${element.localName}${element.classList[0] ? '.' + element.classList[0] : ' ' + short(element.textContent)}`;
    if (outline.hidden) outline.hidden = false;
    for (const key of Object.keys(style)) { if (style[key] !== hoverStyle[key]) outline.style[key] = style[key]; }
    if (label !== hoverLabel) outlineLabel.textContent = label;
    hoverStyle = style; hoverLabel = label;
  }
  function hover(event) {
    if (!active || !editor.hidden || root.contains(event.target) || !(event.target instanceof Element)) return;
    hoverTarget = event.target;
    if (hoverFrame === null) hoverFrame = requestAnimationFrame(renderHover);
  }
  function intercept(event) { if (!active || root.contains(event.target)) return; event.preventDefault(); event.stopImmediatePropagation(); if (event.type === 'click') openEditor(event.target); }
  function setActive(value) {
    active = value; panel.hidden = !value; toggle.setAttribute('aria-pressed', String(value)); toggle.textContent = value ? '◎ Exit inspect' : '◎ App feedback'; closeEditor();
    const method = value ? 'addEventListener' : 'removeEventListener'; window[method]('pointermove', hover, true);
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu']) window[method](type, intercept, true);
  }
  document.addEventListener('keydown', event => { if (event.altKey && event.shiftKey && event.code === 'KeyP') { event.preventDefault(); setActive(!active); } else if (event.key === 'Escape' && active) { event.preventDefault(); if (!editor.hidden) { drafts.set(editing || target, { issueType, uiAction, comment: comment.control.value }); closeEditor(); } else setActive(false); } });
  window.addEventListener('scroll', resetHover, true); window.addEventListener('resize', resetHover); render();
})();
