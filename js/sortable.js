// Drag-to-reorder for a list, by a handle on each item. Works with mouse, touch and pen
// (pointer events), and from the keyboard: focus a handle and press ↑ / ↓.
//
//   sortable(listEl, { item: '.line', handle: '[data-grip]', id: el => el.dataset.line, onDrop: ids => … })
//
// The item moves live under the pointer; `onDrop` gets the new order of ids, only if it changed.
// Call it again after each render (it binds to the list element once).

export function sortable(list, opts) {
  list._sortOpts = opts;
  if (list._sortBound) return;
  list._sortBound = true;

  const items = () => [...list.querySelectorAll(`:scope > ${list._sortOpts.item}`)];
  const order = () => items().map(list._sortOpts.id);
  let drag = null;

  list.addEventListener('pointerdown', e => {
    const handle = e.target.closest(list._sortOpts.handle);
    if (!handle || handle.disabled || e.button > 0) return;
    const el = handle.closest(list._sortOpts.item);
    if (!el || el.parentElement !== list) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    drag = { el, before: order().join('|') };
    el.classList.add('dragging');
  });

  // Pass each neighbour whose middle the pointer has crossed (several, after a fast move).
  const follow = y => {
    const { el } = drag;
    const isItem = n => n?.matches(list._sortOpts.item);
    while (isItem(el.previousElementSibling) && y < mid(el.previousElementSibling)) list.insertBefore(el, el.previousElementSibling);
    while (isItem(el.nextElementSibling) && y > mid(el.nextElementSibling)) list.insertBefore(el.nextElementSibling, el);
  };

  list.addEventListener('pointermove', e => { if (drag) follow(e.clientY); });

  const end = e => {
    if (!drag) return;
    if (e.type === 'pointerup') follow(e.clientY);
    const { el, before } = drag;
    el.classList.remove('dragging');
    drag = null;
    const after = order();
    if (after.join('|') !== before) list._sortOpts.onDrop(after);
  };
  list.addEventListener('pointerup', end);
  list.addEventListener('pointercancel', end);
  list.addEventListener('lostpointercapture', end);

  list.addEventListener('keydown', e => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const handle = e.target.closest(list._sortOpts.handle);
    const el = handle?.closest(list._sortOpts.item);
    if (!el || el.parentElement !== list) return;
    e.preventDefault();
    const sib = e.key === 'ArrowUp' ? el.previousElementSibling : el.nextElementSibling;
    if (!sib?.matches(list._sortOpts.item)) return;
    if (e.key === 'ArrowUp') list.insertBefore(el, sib); else list.insertBefore(sib, el);
    handle.focus();
    list._sortOpts.onDrop(order());
  });
}

const mid = el => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
