(() => {
  'use strict';
  if (new URLSearchParams(location.search).get('pin') !== '1' || document.getElementById('pin-root')) return;

  const issueTypes = ['UI/UX', 'Data', 'New Feature'];
  const defaultUIActions = ['Remove', 'Bold', 'Reduce font', 'Increase font', 'Standardise (max 3 font sizes)'];
  const actionsStorageKey = 'pin-overlay:quick-actions';
  const pageURL = location.href;
  const storageKey = `pin-overlay:${pageURL}`;
  let pins = [], active = false, autoCopy = true, target = null, editing = null;
  const drafts = new Map();
  let uiActions = defaultUIActions, actionDraft = null;
  const annotationMarks = ['Move', 'Remove', 'Highlight'];
  let annotationDraft = null, annotationSource = null, annotationDrag = null, annotationStep = 0;

  try {
    const stored = JSON.parse(localStorage.getItem(actionsStorageKey));
    if (Array.isArray(stored) && stored.every(name => typeof name === 'string' && name.trim())) {
      const names = stored.map(name => name.trim());
      if (new Set(names.map(name => name.toLowerCase())).size === names.length) uiActions = names;
    }
  } catch (_) { /* Storage may be unavailable. */ }

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
      const migrated = { ...pin, issueType, uiAction: issueType === 'UI/UX' && typeof pin.uiAction === 'string' ? pin.uiAction : '', comment: migratedComment };
      if (!validAnnotation(migrated.annotation)) delete migrated.annotation;
      else if (!validDestination(migrated.annotation.destination)) delete migrated.annotation.destination;
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
  const buttonIcon = (control, pathData) => {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg'), path = document.createElementNS(ns, 'path');
    svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('aria-hidden', 'true'); svg.classList.add('pin-action-icon');
    path.setAttribute('d', pathData); svg.append(path); control.prepend(svg);
  };
  const field = (label, control) => {
    const wrapper = make('label', 'field', undefined, editor); make('span', 'field-label', label, wrapper); wrapper.append(control); return wrapper;
  };
  const area = (label, placeholder) => {
    const control = make('textarea', 'comment'); control.placeholder = placeholder; control.setAttribute('aria-label', label); return { wrapper: field(label, control), control };
  };

  const toggle = button('◎ App feedback', root, () => setActive(!active));
  toggle.classList.add('pin-toggle'); toggle.setAttribute('aria-pressed', 'false');
  const markerLayer = make('div', 'marker-layer');
  const annotationLayer = svgElement('svg', { class: 'pin-annotation-layer', 'aria-label': 'Feedback annotations' }, root);
  const annotationCanvas = svgElement('g', {}, annotationLayer);
  const drawSurface = make('div', 'draw-surface'); drawSurface.hidden = true;
  drawSurface.setAttribute('aria-label', 'Draw annotation by dragging; choose a step to redraw');
  const savedMarkers = new Map();
  let markerFrame = null;
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
  const intentHeader = make('div', 'quick-action-header', undefined, intentGroup);
  make('span', 'field-label', 'UI Quick Actions', intentHeader);
  const editActions = button('', intentHeader, openActionSettings);
  editActions.classList.add('pin-action-pencil'); editActions.setAttribute('aria-label', 'Edit UI quick actions'); editActions.title = 'Edit quick actions';
  buttonIcon(editActions, 'm10.2 3.5 2.3 2.3M3 13l3.1-.6 7.1-7.1a1.6 1.6 0 0 0-2.3-2.3l-7.1 7.1L3 13z');
  const intentChips = make('div', 'chips', undefined, intentGroup);
  const emptyActions = make('p', 'hint', 'Add more actions with the pencil.', intentGroup);
  const comment = area('Comments', 'Describe the issue or requested change.');
  const actions = make('div', 'controls', undefined, editor);
  const save = button('Save', actions, () => {}); save.type = 'submit'; save.classList.add('pin-button-primary');
  button('Cancel', actions, closeEditor);
  const remove = button('Delete', actions, () => { pins = pins.filter(pin => pin.id !== editing); closeEditor(); changed(); });
  remove.classList.add('pin-button-danger');

  const annotationPrompt = make('section', 'annotation-prompt'); annotationPrompt.hidden = true;
  annotationPrompt.setAttribute('aria-label', 'Annotate');
  const markPicker = make('div', 'mark-picker', undefined, annotationPrompt);
  markPicker.setAttribute('role', 'group'); markPicker.setAttribute('aria-label', 'Annotation mark');
  const markIcons = ['M3 13 13 3M5 3h8v8', 'm4 4 8 8M12 4l-8 8', 'M14 8a6 4.5 0 1 1-12 0 6 4.5 0 1 1 12 0'];
  const markButtons = annotationMarks.map((mark, index) => {
    const control = button(mark, markPicker, () => chooseMark(mark));
    buttonIcon(control, markIcons[index]); return control;
  });
  const circleStep = button('', annotationPrompt, () => { annotationStep = 0; updateAnnotationPrompt(); });
  circleStep.classList.add('pin-annotation-step'); circleStep.title = 'Drag to draw or redraw the circle';
  const stepDivider = make('span', 'step-divider', '·', annotationPrompt);
  const detailStep = button('', annotationPrompt, () => { if (annotationDraft?.circle) { annotationStep = 1; updateAnnotationPrompt(); } });
  detailStep.classList.add('pin-annotation-step'); detailStep.title = 'Drag to draw or redraw the second mark';
  const annotationControls = make('div', 'annotation-controls', undefined, annotationPrompt);
  button('Cancel', annotationControls, cancelAnnotation);
  const annotationSave = button('Save', annotationControls, saveAnnotation); annotationSave.classList.add('pin-button-primary');
  drawSurface.addEventListener('pointerdown', startAnnotationDrag);
  drawSurface.addEventListener('pointermove', moveAnnotationDrag);
  drawSurface.addEventListener('pointerup', endAnnotationDrag);
  drawSurface.addEventListener('pointercancel', cancelAnnotationDrag);
  drawSurface.addEventListener('lostpointercapture', cancelAnnotationDrag);

  const actionSettings = make('div', 'action-settings', undefined, editor); actionSettings.hidden = true;
  const actionTitle = make('h2', 'heading', 'Edit quick actions', actionSettings); actionTitle.tabIndex = -1;
  make('p', 'action-description', 'Rename, add, or remove buttons.', actionSettings);
  const actionRows = make('div', 'action-rows', undefined, actionSettings);
  const actionTools = make('div', 'action-tools', undefined, actionSettings);
  const addAction = button('Add action', actionTools, () => {
    actionDraft.push({ name: '' });
    renderActionRows(actionDraft.length - 1);
  });
  buttonIcon(addAction, 'M8 3.5v9m-4.5-4.5h9');
  button('Restore to default', actionTools, () => {
    actionDraft = defaultUIActions.map(name => ({ name, originalName: name }));
    renderActionRows();
  });
  const settingsControls = make('div', 'controls', undefined, actionSettings);
  const saveActions = button('Save actions', settingsControls, () => {});
  saveActions.classList.add('pin-button-primary');
  button('Cancel', settingsControls, returnToFeedback);
  actionRows.addEventListener('input', () => {
    actionRows.querySelectorAll('input:invalid').forEach(input => input.setCustomValidity(''));
  });
  document.body.append(root);

  function renderIntentChips() {
    // Keep the label on existing feedback, even if the action is no longer offered.
    const names = uiAction && !uiActions.includes(uiAction) ? [...uiActions, uiAction] : uiActions;
    intentChips.replaceChildren();
    names.filter(value => value !== 'Annotate').forEach(value => button(value, intentChips, () => { uiAction = uiAction === value ? '' : value; refreshFields(); }));
    const annotate = button('Annotate', intentChips, beginAnnotation); annotate.classList.add('pin-annotate');
    buttonIcon(annotate, 'm10.2 3.5 2.3 2.3M3 13l3.1-.6 7.1-7.1a1.6 1.6 0 0 0-2.3-2.3l-7.1 7.1L3 13z');
    emptyActions.hidden = Boolean(names.length);
  }
  function refreshFields() {
    typeButtons.forEach((item, index) => item.setAttribute('aria-pressed', String(issueTypes[index] === issueType)));
    Array.from(intentChips.children).forEach(item => item.setAttribute('aria-pressed', String(item.textContent === uiAction)));
    intentGroup.hidden = issueType !== 'UI/UX';
  }

  function renderActionRows(focusIndex) {
    actionRows.replaceChildren();
    if (!actionDraft.length) make('p', 'hint', 'No quick actions yet.', actionRows);
    let focus;
    actionDraft.forEach((action, index) => {
      const row = make('div', 'action-row', undefined, actionRows);
      let control;
      if (action.removed) {
        const name = action.name.trim();
        row.classList.add('pin-action-removed');
        make('span', 'action-removed-label', name ? `${name} removed` : 'New action removed', row);
        control = button('Undo', row, () => { action.removed = false; renderActionRows(index); });
        control.classList.add('pin-action-undo'); control.setAttribute('aria-label', `Undo removal: ${name || 'new action'}`);
      } else {
        const input = make('input', 'action-name', undefined, row);
        input.type = 'text'; input.value = action.name; input.placeholder = 'Action name';
        input.setAttribute('aria-label', `Action name ${index + 1}`);
        if (action.originalName === undefined) make('span', 'action-new', 'New', row);
        const discard = button('', row, () => { action.removed = true; renderActionRows(index); });
        const labelRemove = () => {
          const name = action.name.trim();
          discard.title = name ? `Remove action: ${name}` : 'Remove new action';
          discard.setAttribute('aria-label', discard.title);
        };
        discard.classList.add('pin-action-discard'); labelRemove();
        input.addEventListener('input', () => { action.name = input.value; labelRemove(); });
        buttonIcon(discard, 'M2.6 4.7h10.8M6 4.7V3.3a.7.7 0 0 1 .7-.7h2.6a.7.7 0 0 1 .7.7v1.4m2 0-.6 7.8a1.1 1.1 0 0 1-1.1 1H5.7a1.1 1.1 0 0 1-1.1-1L4 4.7M6.6 7v3.8m2.8-3.8v3.8');
        control = input;
      }
      if (index === focusIndex) focus = control;
    });
    placeEditor(target?.getBoundingClientRect());
    focus?.focus();
  }
  function openActionSettings() {
    actionDraft = uiActions.map(name => ({ name, originalName: name }));
    actionSettings.hidden = false; editor.classList.add('pin-editing-actions');
    editor.setAttribute('aria-label', 'Edit quick actions');
    save.type = 'button'; saveActions.type = 'submit';
    editor.scrollTop = 0;
    renderActionRows();
    actionTitle.focus({ preventScroll: true });
  }
  function closeActionSettings() {
    actionDraft = null; actionSettings.hidden = true; editor.classList.remove('pin-editing-actions');
    editor.setAttribute('aria-label', 'Edit feedback');
    save.type = 'submit'; saveActions.type = 'button';
    actionRows.replaceChildren();
  }
  function returnToFeedback() {
    closeActionSettings();
    renderIntentChips(); refreshFields();
    placeEditor(target?.getBoundingClientRect());
    editActions.focus();
  }
  function saveActionSettings() {
    const remaining = actionDraft.filter(action => !action.removed);
    const names = remaining.map(action => action.name.trim());
    const inputs = actionRows.querySelectorAll('input');
    const seen = new Set();
    for (const [index, name] of names.entries()) {
      const key = name.toLowerCase();
      if (!name || seen.has(key)) {
        inputs[index].setCustomValidity(name ? 'Use a different name for each action.' : 'Enter an action name.');
        inputs[index].reportValidity();
        return;
      }
      seen.add(key);
    }
    if (!editing && uiActions.includes(uiAction)) {
      const selected = remaining.find(action => action.originalName === uiAction);
      uiAction = selected?.name.trim() ?? '';
    }
    uiActions = names;
    try {
      if (names.length === defaultUIActions.length && names.every((name, index) => name === defaultUIActions[index])) localStorage.removeItem(actionsStorageKey);
      else localStorage.setItem(actionsStorageKey, JSON.stringify(names));
    }
    catch (_) { status.textContent = 'Storage unavailable — quick actions won’t survive a reload'; }
    returnToFeedback();
  }

  editor.addEventListener('submit', event => {
    event.preventDefault();
    if (actionDraft) { saveActionSettings(); return; }
    const values = { issueType, uiAction: issueType === 'UI/UX' ? uiAction : '', comment: comment.control.value };
    saveFeedback(values);
  });
  function saveFeedback(values, element) {
    if (editing) {
      const pin = pins.find(pin => pin.id === editing);
      if (pin) {
        Object.assign(pin, values);
        if (pin.annotation && pin.uiAction !== pin.annotation.mark) delete pin.annotation;
      }
    } else if (element || target?.isConnected) pins.push({ id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`, url: pageURL, viewport: { width: innerWidth, height: innerHeight }, timestamp: new Date().toISOString(), element: element || describe(target), ...values });
    closeEditor(); changed();
  }

  function pageMatches(selector) { return [...document.querySelectorAll(selector)].filter(element => !root.contains(element)); }
  function count(selector) { try { return pageMatches(selector).length; } catch (_) { return 0; } }
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

  function validPoint(point) {
    return point && Number.isFinite(point.x) && Number.isFinite(point.y);
  }
  function validBox(box) {
    return validPoint(box) && Number.isFinite(box.width) && Number.isFinite(box.height) && box.width >= 6 && box.height >= 6;
  }
  function validStroke(stroke, mark) {
    if (!validPoint(stroke?.start) || !validPoint(stroke?.end)) return false;
    const dx = Math.abs(stroke.end.x - stroke.start.x), dy = Math.abs(stroke.end.y - stroke.start.y);
    return mark === 'Remove' ? dx >= 6 && dy >= 6 : Math.hypot(dx, dy) >= 6;
  }
  function validAnnotation(annotation) {
    if (!annotation || !annotationMarks.includes(annotation.mark)) return false;
    const { circle, stroke } = annotation;
    return validBox(circle) && (annotation.mark === 'Highlight' || validStroke(stroke, annotation.mark));
  }
  function validDestination(destination) {
    const element = destination?.element;
    return element && typeof element.tag === 'string' && typeof element.selector === 'string' && Array.isArray(element.classes) && element.classes.every(name => typeof name === 'string') &&
      typeof destination.label === 'string' && typeof destination.relation === 'string' && typeof destination.placeholder === 'string';
  }
  function svgElement(tag, attributes, parent) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
    parent.append(element); return element;
  }
  function beginAnnotation() {
    if (!target?.isConnected || actionDraft) return;
    annotationSource = describe(target);
    annotationDraft = { mark: 'Move', circle: null, stroke: null };
    annotationStep = 0;
    intentChips.querySelector('.pin-annotate').setAttribute('aria-pressed', 'true');
    editor.hidden = true; panel.hidden = true; drawSurface.hidden = false; annotationPrompt.hidden = false;
    root.classList.add('pin-annotating'); resetHover();
    updateAnnotationPrompt(); renderAnnotations(); circleStep.focus();
  }
  function chooseMark(mark) {
    if (!annotationDraft || annotationDrag) return;
    if (mark !== annotationDraft.mark) {
      annotationDraft.mark = mark; annotationDraft.stroke = null; delete annotationDraft.destination;
      annotationStep = annotationDraft.circle && mark !== 'Highlight' ? 1 : 0;
    }
    updateAnnotationPrompt(); renderAnnotations();
  }
  function updateAnnotationPrompt() {
    if (!annotationDraft) return;
    const { mark, circle, stroke } = annotationDraft, single = mark === 'Highlight';
    markButtons.forEach((control, index) => { control.setAttribute('aria-pressed', String(annotationMarks[index] === mark)); control.disabled = Boolean(annotationDrag); });
    circleStep.textContent = `${circle ? '✓ ' : ''}${single ? '' : '1 '}Circle the element`;
    detailStep.textContent = `${stroke ? '✓ ' : ''}2 ${mark === 'Remove' ? 'Draw an X over it' : 'Draw an arrow to where it should go'}`;
    circleStep.setAttribute('aria-current', annotationStep === 0 ? 'step' : 'false');
    detailStep.setAttribute('aria-current', annotationStep === 1 ? 'step' : 'false');
    circleStep.disabled = Boolean(annotationDrag); detailStep.disabled = !circle || Boolean(annotationDrag);
    detailStep.hidden = single; stepDivider.hidden = single;
    annotationSave.disabled = Boolean(annotationDrag) || !validAnnotation(annotationDraft);
  }
  function clearAnnotationMode() {
    if (annotationDrag) cancelAnnotationDrag();
    annotationDraft = null; annotationSource = null;
    annotationPrompt.hidden = true; drawSurface.hidden = true; panel.hidden = !active;
    root.classList.remove('pin-annotating'); renderAnnotations();
  }
  function cancelAnnotation() {
    if (!annotationDraft) return;
    clearAnnotationMode(); refreshFields(); editor.hidden = false;
    placeEditor(target?.getBoundingClientRect()); showOutline(target); comment.control.focus();
  }
  function saveAnnotation() {
    if (annotationDrag || !validAnnotation(annotationDraft)) return;
    const annotation = { ...annotationDraft }, source = annotationSource;
    if (annotation.mark === 'Move') annotation.destination = moveDestination(annotation.stroke.end) || annotation.destination;
    const name = source.displayedValue || source.tag;
    const generated = annotation.mark === 'Move' ? `Move “${name}” ${annotation.destination ? `next to ${annotation.destination.label}` : 'to the marked spot'}` :
      annotation.mark === 'Remove' ? `Remove “${name}”` : `Look at “${name}”`;
    const values = { issueType, uiAction: annotation.mark, comment: comment.control.value.trim() ? comment.control.value : generated, annotation };
    clearAnnotationMode(); saveFeedback(values, source);
  }
  function dragShape(start, end, step) {
    return step === 0 ? { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) } : { start, end };
  }
  function startAnnotationDrag(event) {
    if (!annotationDraft || annotationDrag || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    const key = annotationStep === 0 ? 'circle' : 'stroke';
    annotationDrag = { id: event.pointerId, start: { x: event.pageX, y: event.pageY }, step: annotationStep, previous: annotationDraft[key] };
    drawSurface.setPointerCapture(event.pointerId);
    updateAnnotationPrompt();
  }
  function moveAnnotationDrag(event) {
    if (!annotationDrag || event.pointerId !== annotationDrag.id) return;
    event.preventDefault();
    const { start, step } = annotationDrag;
    annotationDraft[step === 0 ? 'circle' : 'stroke'] = dragShape(start, { x: event.pageX, y: event.pageY }, step);
    renderAnnotations();
  }
  function endAnnotationDrag(event) {
    if (!annotationDrag || event.pointerId !== annotationDrag.id) return;
    moveAnnotationDrag(event);
    const { step, start, id, previous } = annotationDrag;
    const end = { x: event.pageX, y: event.pageY }, shape = dragShape(start, end, step);
    const valid = step === 0 ? validBox(shape) : validStroke(shape, annotationDraft.mark);
    annotationDraft[step === 0 ? 'circle' : 'stroke'] = valid ? shape : previous;
    annotationDrag = null; drawSurface.releasePointerCapture(id);
    if (valid && step === 0) {
      annotationDraft.stroke = null; delete annotationDraft.destination;
      annotationStep = annotationDraft.mark === 'Highlight' ? 0 : 1;
    } else if (valid && annotationDraft.mark === 'Move') annotationDraft.destination = moveDestination(end);
    updateAnnotationPrompt(); renderAnnotations();
  }
  function cancelAnnotationDrag(event) {
    if (!annotationDrag || (event && event.pointerId !== annotationDrag.id)) return;
    const { id, step, previous } = annotationDrag;
    annotationDraft[step === 0 ? 'circle' : 'stroke'] = previous;
    annotationDrag = null;
    if (drawSurface.hasPointerCapture(id)) drawSurface.releasePointerCapture(id);
    updateAnnotationPrompt(); renderAnnotations();
  }
  function destinationName(element) {
    if (element.matches('input[type="search"], [role="searchbox"]') || /search/i.test(element.getAttribute('placeholder') || '')) return 'the search field';
    const name = short(element.getAttribute('aria-label') || element.getAttribute('placeholder') || element.labels?.[0]?.textContent || element.textContent);
    if (element.matches('input, textarea')) return name ? `the “${name}” field` : 'the input field';
    if (element.matches('select')) return name ? `the “${name}” dropdown` : 'the dropdown';
    if (element.matches('button, [role="button"]')) return name ? `the “${name}” button` : 'the button';
    return name ? `“${name}”` : `the ${element.localName} element`;
  }
  function moveDestination(point) {
    const x = point.x - scrollX, y = point.y - scrollY;
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return null;
    const hits = document.elementsFromPoint(x, y).filter(element => !root.contains(element));
    const controls = 'input:not([type="hidden"]), textarea, select, button, a[href], [role="button"], [role="searchbox"]';
    let element = hits[0]?.closest(controls);
    if (!element) {
      const nearest = pageMatches(controls).map(control => {
        const rect = control.getBoundingClientRect();
        const distance = Math.hypot(Math.max(rect.left - x, 0, x - rect.right), Math.max(rect.top - y, 0, y - rect.bottom));
        return { control, distance, visible: rect.width && rect.height && getComputedStyle(control).visibility !== 'hidden' };
      }).filter(item => item.visible && item.distance <= 96).sort((a, b) => a.distance - b.distance)[0];
      element = nearest?.control || hits.find(hit => !hit.matches('html, body'));
    }
    if (!element) return null;
    const rect = element.getBoundingClientRect(), label = destinationName(element);
    const relation = x < rect.left ? 'just left of' : x > rect.right ? 'just right of' : y < rect.top ? 'just above' : y > rect.bottom ? 'just below' : 'on';
    return { element: describe(element), label, relation: `${relation} ${label}`, placeholder: short(element.getAttribute('placeholder')) };
  }
  function linePath(start, end) {
    return `M${start.x} ${start.y}L${end.x} ${end.y}`;
  }
  function arrowPath(start, end) {
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length < 1) return '';
    const x = (end.x - start.x) / length, y = (end.y - start.y) / length;
    const headLength = 13, headHalfWidth = 7;
    const base = { x: end.x - x * headLength, y: end.y - y * headLength };
    const left = { x: base.x - y * headHalfWidth, y: base.y + x * headHalfWidth };
    const right = { x: base.x + y * headHalfWidth, y: base.y - x * headHalfWidth };
    return linePath(start, end) + linePath(left, end) + linePath(end, right);
  }
  function annotationPath(annotation) {
    if (!annotation.stroke || annotation.mark === 'Highlight') return '';
    const { start, end } = annotation.stroke;
    if (annotation.mark === 'Remove') return linePath(start, end) + linePath({ x: start.x, y: end.y }, { x: end.x, y: start.y });
    return arrowPath(start, end);
  }
  function drawAnnotation(annotation, index, pin) {
    const group = svgElement('g', { class: `pin-annotation${annotation.mark === 'Remove' ? ' pin-annotation-remove' : ''}`, ...(pin ? { 'data-note-id': pin.id } : { 'data-draft': '' }) }, annotationCanvas);
    const circle = annotation.circle;
    if (!circle) return;
    const cx = circle.x + circle.width / 2, cy = circle.y + circle.height / 2;
    svgElement('ellipse', { cx, cy, rx: circle.width / 2, ry: circle.height / 2, class: 'pin-annotation-circle' }, group);
    const path = annotationPath(annotation);
    if (path) {
      svgElement('path', { d: path, class: 'pin-annotation-halo' }, group);
      svgElement('path', { d: path, class: 'pin-annotation-stroke' }, group);
    }
    const dot = svgElement('g', { class: 'pin-annotation-dot', transform: `translate(${cx - circle.width * .36} ${cy - circle.height * .36})` }, group);
    svgElement('circle', { r: 10 }, dot);
    svgElement('text', { 'text-anchor': 'middle', dy: '.35em' }, dot).textContent = String(index + 1);
    if (pin) {
      dot.setAttribute('role', 'button'); dot.setAttribute('tabindex', '0'); dot.setAttribute('aria-label', `Show feedback note ${index + 1}`);
      dot.addEventListener('click', () => highlightCard(pin));
      dot.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); highlightCard(pin); } });
    }
  }
  function positionAnnotations() {
    annotationLayer.setAttribute('viewBox', `0 0 ${innerWidth} ${innerHeight}`);
    annotationCanvas.setAttribute('transform', `translate(${-scrollX} ${-scrollY})`);
  }
  function renderAnnotations() {
    annotationCanvas.replaceChildren(); annotationLayer.style.display = active ? '' : 'none';
    if (!active) return;
    pins.forEach((pin, index) => { if (pin.annotation && !(annotationDraft && pin.id === editing)) drawAnnotation(pin.annotation, index, pin); });
    if (annotationDraft) drawAnnotation(annotationDraft, editing ? pins.findIndex(pin => pin.id === editing) : pins.length);
    positionAnnotations();
  }
  function annotationElement(element) {
    return `${element.tag}${element.classes.map(name => `.${name}`).join('')}${element.displayedValue ? ` “${element.displayedValue}”` : ''}`;
  }
  function annotationReport(annotation, element) {
    const source = annotationElement(element);
    if (annotation.mark !== 'Move') return `${annotation.mark}: ${source}.`;
    const destination = annotation.destination;
    if (!destination?.element || !destination.relation) return `Move: ${source} to the marked spot.`;
    const control = destination.element, selector = control.selector.startsWith('#') ? `${control.tag}${control.selector}` : `${control.tag}${control.classes.map(name => `.${name}`).join('')}`;
    return `Move: ${source} to ${destination.relation} (${selector}${destination.placeholder ? `; placeholder “${destination.placeholder}”` : ''}).`;
  }

  const elementLabel = element => `${element.tag}${element.classes[0] ? '.' + element.classes[0] : element.displayedValue ? ' ' + element.displayedValue : ''}`.trim();
  const inline = value => String(value || '').replace(/\s+/g, ' ').replace(/[\\`*_\[\]<>]/g, '\\$&');
  const present = value => String(value || '').trim();
  function markdown() {
    const lines = [`## App feedback — ${pins.length} ${pins.length === 1 ? 'item' : 'items'}`, `- Page: ${pageURL}`];
    pins.forEach((pin, index) => {
      const element = pin.element;
      const intent = pin.annotation?.mark || pin.uiAction;
      const kind = pin.issueType === 'UI/UX' && intent ? `${pin.issueType} / ${inline(intent)}` : pin.issueType;
      lines.push('', `### ${index + 1}. [${kind}] ${inline(elementLabel(element))}`, `- Selector: \`${element.selector.replace(/`/g, '\\`')}\` (${element.selectorConfidence} confidence)`);
      if (present(element.displayedValue)) lines.push(`- Text/value: ${inline(element.displayedValue)}`);
      if (present(pin.comment)) lines.push(`- Request: ${inline(pin.comment)}`);
      if (pin.annotation) lines.push(`- ${inline(annotationReport(pin.annotation, element))}`);
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
    copyQueue = copyQueue.catch(() => {}).then(() => promise).then(() => { if (sequence === copySequence) status.textContent = `Clipboard updated — ${total} ${total === 1 ? 'item' : 'items'} ready to paste`; }).catch(error => { if (sequence === copySequence) status.textContent = 'Clipboard update failed — use Copy all'; console.warn('App feedback overlay: clipboard update failed', error); });
  }
  function changed() {
    try { if (pins.length) localStorage.setItem(storageKey, JSON.stringify(pins)); else localStorage.removeItem(storageKey); } catch (_) { status.textContent = 'Storage unavailable — feedback remains in memory'; }
    render(); if (autoCopy) copyAll();
  }
  const listItems = new Map();
  let highlightedCard = null;
  function clearCardHighlight() {
    highlightedCard?.classList.remove('pin-card-highlighted');
    highlightedCard = null;
  }
  function highlightCard(pin) {
    const card = listItems.get(pin)?.firstChild;
    if (!card) return;
    clearCardHighlight();
    highlightedCard = card;
    card.classList.add('pin-card-highlighted');
    card.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    card.focus({ preventScroll: true });
  }
  function openSavedNote(pin) {
    if (actionDraft) return;
    const element = savedPinTarget(pin.element.selector);
    const rect = element?.getBoundingClientRect();
    const offscreen = rect && (rect.bottom <= 0 || rect.top >= document.documentElement.clientHeight);
    element?.scrollIntoView({ block: offscreen ? 'center' : 'nearest', inline: 'nearest', behavior: 'instant' });
    openEditor(element, pin);
  }
  function render() {
    const current = new Set(pins);
    listItems.forEach((item, pin) => { if (!current.has(pin)) { item.remove(); listItems.delete(pin); } });
    if (highlightedCard && !highlightedCard.isConnected) clearCardHighlight();
    if (pins.length) list.querySelector('.pin-empty')?.remove();
    pins.forEach((pin, index) => {
      let item = listItems.get(pin);
      if (!item) {
        item = make('li', 'item', undefined, list);
        button('', item, () => openSavedNote(pin)); listItems.set(pin, item);
        const card = item.firstChild; card.classList.add('pin-card');
        ['number', 'tags', 'comment'].forEach(part => make('span', `card-${part}`, undefined, card));
        ['type', 'action'].forEach(part => make('span', `card-${part}`, undefined, card.children[1]));
      }
      const card = item.firstChild, [number, tags, text] = card.children, [type, action] = tags.children;
      const request = short(pin.comment);
      const parts = { number: String(index + 1), type: pin.issueType, action: pin.annotation?.mark || pin.uiAction || '', text: request || 'No comment' };
      [[number, parts.number], [type, parts.type], [action, parts.action], [text, parts.text]].forEach(([element, content]) => { if (element.textContent !== content) element.textContent = content; });
      const label = `${parts.number}. ${[parts.type, parts.action].filter(Boolean).join(', ')}: ${parts.text}`;
      if (card.getAttribute('aria-label') !== label) card.setAttribute('aria-label', label);
      if (card.dataset.type !== pin.issueType) card.dataset.type = pin.issueType;
      if (action.hidden === Boolean(parts.action)) action.hidden = !parts.action;
      text.classList.toggle('pin-card-comment-empty', !request);
    });
    if (!pins.length && !list.firstChild) make('li', 'empty', 'No feedback yet', list);
    renderSavedMarkers();
  }
  function closeEditor() { if (actionDraft) closeActionSettings(); editor.hidden = true; target = null; editing = null; resetHover(); }
  function placeEditor(rect) {
    const edge = 12, viewportGap = 8;
    editor.style.width = ''; editor.style.maxHeight = `${innerHeight - (viewportGap * 2)}px`;
    const { width, height } = editor.getBoundingClientRect();
    const viewport = { left: viewportGap, top: viewportGap, right: innerWidth - viewportGap, bottom: innerHeight - viewportGap };
    const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const expand = box => ({ left: box.left - edge, top: box.top - edge, right: box.right + edge, bottom: box.bottom + edge });
    const obstacles = [panel, toggle].filter(element => element.getClientRects().length).map(element => expand(element.getBoundingClientRect()));
    const horizontalTop = Math.max(viewportGap, Math.min(rect?.top || 24, innerHeight - height - viewportGap));
    const placements = rect ? [
      { room: innerWidth - rect.right - edge, fit: innerWidth - rect.right - edge >= width, left: rect.right + edge, top: horizontalTop, maxHeight: innerHeight - (viewportGap * 2) },
      { room: rect.left - edge, fit: rect.left - edge >= width, left: rect.left - width - edge, top: horizontalTop, maxHeight: innerHeight - (viewportGap * 2) },
      { room: innerHeight - rect.bottom - edge, fit: innerHeight - rect.bottom - edge >= 280, left: Math.max(viewportGap, Math.min(rect.left, innerWidth - width - viewportGap)), top: rect.bottom + edge, maxHeight: innerHeight - rect.bottom - edge - viewportGap },
      { room: rect.top - edge, fit: rect.top - edge >= 280, left: Math.max(viewportGap, Math.min(rect.left, innerWidth - width - viewportGap)), top: viewportGap, maxHeight: rect.top - edge - viewportGap },
    ] : [{ room: 0, fit: true, left: innerWidth - width - 24, top: 24 }];
    let placement = placements.filter(option => {
      const box = { left: option.left, top: option.top, right: option.left + width, bottom: option.top + height };
      return option.fit && box.left >= viewport.left && box.top >= viewport.top && box.right <= viewport.right && box.bottom <= viewport.bottom && !obstacles.some(obstacle => intersects(box, obstacle)) && (!rect || !intersects(box, expand(rect)));
    }).sort((left, right) => right.room - left.room)[0];
    if (!placement) {
      const freeRegions = blocked => blocked.reduce((regions, obstacle) => regions.flatMap(region => {
        if (!intersects(region, obstacle)) return [region];
        return [
          { ...region, right: Math.min(region.right, obstacle.left) },
          { ...region, left: Math.max(region.left, obstacle.right) },
          { ...region, bottom: Math.min(region.bottom, obstacle.top) },
          { ...region, top: Math.max(region.top, obstacle.bottom) },
        ].filter(box => box.right > box.left && box.bottom > box.top);
      }), [viewport]);
      const targetRegions = rect ? freeRegions([...obstacles, expand(rect)]) : [];
      const obstacleRegions = freeRegions(obstacles);
      const usable = region => region.bottom - region.top >= Math.min(280, height);
      const fitsForm = region => {
        editor.style.width = `${Math.min(width, region.right - region.left)}px`;
        return region.bottom - region.top >= editor.scrollHeight + (editor.offsetHeight - editor.clientHeight);
      };
      const regions = [targetRegions.filter(fitsForm), obstacleRegions.filter(fitsForm), targetRegions.filter(usable), obstacleRegions.filter(usable), obstacleRegions].find(options => options.length);
      const region = regions.sort((a, b) => (b.right - b.left) * (b.bottom - b.top) - (a.right - a.left) * (a.bottom - a.top))[0];
      if (!region) return;
      const availableWidth = Math.min(width, region.right - region.left);
      editor.style.width = `${availableWidth}px`;
      placement = { left: Math.max(region.left, Math.min(rect?.left ?? innerWidth - availableWidth - 24, region.right - availableWidth)), top: region.top, maxHeight: region.bottom - region.top };
    }
    editor.style.left = `${placement.left}px`; editor.style.top = `${placement.top}px`;
    if (placement.maxHeight !== undefined) editor.style.maxHeight = `${placement.maxHeight}px`;
  }
  function savedPinTarget(selector) {
    if (!selector) return null;
    try {
      const matches = pageMatches(selector);
      if (matches.length === 1) return matches[0];
    } catch (_) { /* A stored selector may be invalid. */ }
    return null;
  }
  function renderSavedMarkers() {
    markerLayer.replaceChildren();
    savedMarkers.clear();
    renderAnnotations();
    if (!active) return;
    pins.forEach((pin, index) => {
      if (pin.annotation) return;
      const element = savedPinTarget(pin.element.selector);
      if (!element) return;
      if (!savedMarkers.has(element)) savedMarkers.set(element, make('div', 'marker-group', undefined, markerLayer));
      const dot = make('button', 'marker-dot', String(index + 1), savedMarkers.get(element));
      dot.type = 'button';
      dot.setAttribute('aria-label', `Show feedback note ${index + 1}`);
      dot.addEventListener('click', () => highlightCard(pin));
    });
    positionSavedMarkers();
  }
  function positionSavedMarkers() {
    const { clientWidth: width, clientHeight: height } = document.documentElement;
    savedMarkers.forEach((marker, element) => {
      const rect = element.getBoundingClientRect();
      marker.hidden = !rect.width || !rect.height || rect.right <= 0 || rect.bottom <= 0 || rect.left >= width || rect.top >= height || getComputedStyle(element).visibility !== 'visible';
      if (marker.hidden) return;
      const markerWidth = marker.offsetWidth, markerHeight = marker.offsetHeight;
      marker.style.left = `${Math.max(2, Math.min(rect.right + 9 - markerWidth, width - markerWidth - 2))}px`;
      marker.style.top = `${Math.max(2, Math.min(rect.top - markerHeight / 2, height - markerHeight - 2))}px`;
    });
  }
  function scheduleMarkerPosition() {
    if (!savedMarkers.size || markerFrame !== null) return;
    markerFrame = requestAnimationFrame(() => { markerFrame = null; positionSavedMarkers(); });
  }
  function openEditor(element, pin) {
    if (actionDraft) return;
    resetHover();
    clearCardHighlight();
    const key = pin?.id || element, values = drafts.get(key) || pin;
    drafts.delete(key);
    target = element; editing = pin?.id || null; issueType = issueTypes.includes(values?.issueType) ? values.issueType : 'UI/UX'; uiAction = issueType === 'UI/UX' ? values?.uiAction || '' : '';
    comment.control.value = values?.comment || ''; remove.hidden = !pin;
    title.textContent = pin ? 'Edit feedback' : 'New feedback'; renderIntentChips(); refreshFields(); editor.hidden = false;
    placeEditor(element?.getBoundingClientRect()); comment.control.focus();
    showOutline(element);
  }
  let hoverFrame = null, hoverTarget = null, outlineText = null, outlineStyle = {};
  function resetHover() {
    if (hoverFrame !== null) cancelAnimationFrame(hoverFrame);
    hoverFrame = null; hoverTarget = null;
    if (!outline.hidden) outline.hidden = true;
  }
  function renderHover() {
    hoverFrame = null;
    const element = hoverTarget; hoverTarget = null;
    if (active && editor.hidden && !annotationDraft) showOutline(element);
  }
  function showOutline(element) {
    const rect = element?.isConnected ? element.getBoundingClientRect() : null;
    if (!rect?.width || !rect.height || rect.right <= 0 || rect.bottom <= 0 || rect.left >= document.documentElement.clientWidth || rect.top >= document.documentElement.clientHeight) { resetHover(); return; }
    const style = { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` };
    const label = `${element.localName}${element.classList[0] ? '.' + element.classList[0] : ' ' + short(element.textContent)}`;
    outline.classList.toggle('pin-outline-selected', Boolean(editing));
    if (outline.hidden) outline.hidden = false;
    for (const key of Object.keys(style)) { if (style[key] !== outlineStyle[key]) outline.style[key] = style[key]; }
    if (label !== outlineText) outlineLabel.textContent = label;
    const labelRect = outlineLabel.getBoundingClientRect();
    outlineLabel.style.left = `${Math.max(0, Math.min(rect.left, document.documentElement.clientWidth - labelRect.width))}px`;
    const above = rect.top - labelRect.height - 4, below = rect.bottom + 4;
    const top = above >= 0 ? above : below + labelRect.height <= document.documentElement.clientHeight ? below : Math.max(0, rect.top);
    outlineLabel.style.top = `${top}px`;
    outlineStyle = style; outlineText = label;
  }
  function hover(event) {
    if (!active || !editor.hidden || annotationDraft) return;
    if (!(event.target instanceof Element) || root.contains(event.target)) { resetHover(); return; }
    hoverTarget = event.target;
    if (hoverFrame === null) hoverFrame = requestAnimationFrame(renderHover);
  }
  function intercept(event) { if (!active || annotationDraft || root.contains(event.target)) return; event.preventDefault(); event.stopImmediatePropagation(); if (event.type === 'click') openEditor(event.target); }
  function setActive(value) {
    if (annotationDraft) {
      cancelAnnotation(); drafts.set(editing || target, { issueType, uiAction, comment: comment.control.value });
    }
    active = value; panel.hidden = !value; toggle.setAttribute('aria-pressed', String(value)); toggle.textContent = value ? '◎ Exit inspect' : '◎ App feedback'; closeEditor();
    clearCardHighlight();
    renderSavedMarkers();
    const method = value ? 'addEventListener' : 'removeEventListener'; window[method]('pointermove', hover, true);
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu']) window[method](type, intercept, true);
  }
  document.addEventListener('keydown', event => {
    if (event.altKey && event.shiftKey && event.code === 'KeyP') { event.preventDefault(); setActive(!active); }
    else if (event.key === 'Escape' && active) {
      event.preventDefault();
      if (annotationDraft) cancelAnnotation();
      else if (actionDraft) returnToFeedback();
      else if (!editor.hidden) { drafts.set(editing || target, { issueType, uiAction, comment: comment.control.value }); closeEditor(); }
      else setActive(false);
    }
  });
  window.addEventListener('scroll', () => {
    if (editor.hidden || annotationDraft) resetHover(); else showOutline(target);
    positionAnnotations();
    scheduleMarkerPosition();
  }, true);
  window.addEventListener('resize', () => {
    resetHover(); scheduleMarkerPosition(); positionAnnotations();
    if (!editor.hidden) { placeEditor(target?.getBoundingClientRect()); showOutline(target); }
  });
  render();
})();
