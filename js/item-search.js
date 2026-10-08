// <item-search>: the app's one way to pick a record (a wine, a recipe…) from a long list. A search
// box with matching results underneath, used in place of a dropdown. Use it for any new picker.
//
//   <item-search data-add-wine placeholder="Search wines…" value="ING-0001"></item-search>
//   el.items = [{ value, label, sub }]   // `sub` is a second, quieter line that is searched too
//
// It behaves like a <select>: `el.value` is the chosen item's value ('' for none) and it fires a
// bubbling `change` event, so delegated change listeners keep working. Clearing the box clears the
// choice. Views that rebuild their HTML just set `value` in the markup and assign `items` again.
//
// With the `allow-new` attribute it is a text field with suggestions instead: whatever is typed is
// the value, a suggestion is only a shortcut, and typing a listed name without its accents
// ("reserve") resolves to the listed spelling ("Réserve"). Use it in place of <datalist>, whose
// suggestions don't ignore accents.

import { esc, matches, fold } from './ui.js';

const MAX_RESULTS = 8;

class ItemSearch extends HTMLElement {
  #items = [];
  #value = '';
  #input = null;
  #list = null;
  #active = -1;
  #shown = [];
  #told = '';

  connectedCallback() {
    if (this.#input) return;
    this.#value = this.getAttribute('value') || '';
    this.#told = this.#value;
    const label = this.getAttribute('aria-label') || this.getAttribute('placeholder') || 'Search';
    this.removeAttribute('aria-label');
    this.innerHTML = `
      <input type="search" role="combobox" aria-autocomplete="list" aria-expanded="false" autocomplete="off"
        placeholder="${esc(this.getAttribute('placeholder') || 'Search…')}" aria-label="${esc(label)}">
      <div class="results item-results" role="listbox" hidden></div>`;
    this.#input = this.querySelector('input');
    this.#list = this.querySelector('.item-results');
    // A picker opens its list as soon as it has focus; a text field waits for typing or a tap.
    this.#input.addEventListener('focus', () => { if (!this.#free) { this.#input.select(); this.#open(''); } });
    // A tap on a box that already has focus should bring the list back too.
    this.#input.addEventListener('click', () => { if (this.#list.hidden) this.#open(this.#free ? this.#input.value : ''); });
    this.#input.addEventListener('input', e => {
      // Typed text is the value of a text field straight away, so a form can read it mid-edit.
      if (this.#free) this.#value = this.#resolve(this.#input.value);
      else e.stopPropagation();
      this.#open(this.#input.value);
    });
    // The inner box's own change event would look like a choice to delegated listeners.
    this.#input.addEventListener('change', e => e.stopPropagation());
    this.#input.addEventListener('keydown', e => this.#onKey(e));
    this.#input.addEventListener('blur', () => this.#close(true));
    // Keep focus in the box while a result is being tapped, so blur doesn't close the list first.
    this.#list.addEventListener('mousedown', e => e.preventDefault());
    this.#list.addEventListener('click', e => {
      const hit = e.target.closest('[data-value]');
      if (hit) this.#choose(hit.dataset.value);
    });
    this.#sync();
  }

  get value() { return this.#value; }

  set value(v) {
    this.#value = v == null ? '' : String(v);
    this.#told = this.#value;
    this.#sync();
  }

  get items() { return this.#items; }

  set items(list) {
    this.#items = list || [];
    this.#sync();
  }

  focus() { this.#input?.focus(); }

  get #free() { return this.hasAttribute('allow-new'); }

  get #selected() { return this.#items.find(i => String(i.value) === this.#value) || null; }

  /** What the box should read for the current value. */
  get #text() { return this.#selected?.label ?? (this.#free ? this.#value : ''); }

  /** Free text → the listed item it names (ignoring case and accents), or the text itself. */
  #resolve(text) {
    const typed = text.trim();
    const hit = typed && this.#items.find(i => fold(i.label) === fold(typed));
    return hit ? String(hit.value) : typed;
  }

  /** Show the chosen item's name in the box, unless the user is in the middle of typing. */
  #sync() {
    if (this.#input && document.activeElement !== this.#input) this.#input.value = this.#text;
  }

  #open(query) {
    const q = query.trim();
    const found = q ? this.#items.filter(i => matches(q, i.label, i.sub ?? '')) : this.#items;
    // Names starting with what was typed come first.
    const starts = i => (q && fold(i.label).startsWith(fold(q)) ? 0 : 1);
    this.#shown = found.slice().sort((a, b) => starts(a) - starts(b)).slice(0, MAX_RESULTS);
    // In a text field Enter keeps what was typed, so no suggestion is pre-selected.
    this.#active = q && this.#shown.length && !this.#free ? 0 : -1;
    if (this.#free && (!q || !this.#shown.length)) { this.#hide(); return; }
    const more = found.length - this.#shown.length;
    this.#list.innerHTML = this.#shown.length
      ? this.#shown.map((i, n) => `
        <button type="button" class="result" role="option" tabindex="-1" data-value="${esc(String(i.value))}" aria-selected="${n === this.#active}">
          <span class="line-text"><span class="line-name">${esc(i.label)}</span>${i.sub ? `<span class="line-sub">${esc(i.sub)}</span>` : ''}</span>
        </button>`).join('') + (more > 0 ? `<p class="item-more">${more} more. Keep typing to narrow it down.</p>` : '')
      : `<p class="item-more">${this.#items.length ? 'Nothing matches.' : (this.getAttribute('empty-text') || 'Nothing to choose from.')}</p>`;
    this.#list.hidden = false;
    this.#input.setAttribute('aria-expanded', 'true');
    this.#list.scrollIntoView?.({ block: 'nearest' });
  }

  #hide() {
    this.#list.hidden = true;
    this.#input?.setAttribute('aria-expanded', 'false');
  }

  #close(commit) {
    if (!this.#list) return;
    if (this.#free) {
      // Leaving a text field commits what it says.
      this.#hide();
      if (commit) this.#commit(this.#resolve(this.#input.value));
      return;
    }
    if (this.#list.hidden) return;
    this.#hide();
    // Leaving the box empty clears the choice; leaving half-typed text puts the choice back.
    if (commit && this.#input.value.trim() === '' && this.#value) this.#choose('');
    else if (commit) this.#input.value = this.#text;
  }

  #choose(value) {
    this.#hide();
    this.#commit(value);
  }

  /** Settle on a value, and tell listeners if it differs from the last one they heard about. */
  #commit(value) {
    this.#value = value;
    this.#input.value = this.#text;
    if (value === this.#told) return;
    this.#told = value;
    this.dispatchEvent(new Event('change', { bubbles: true }));
  }

  #onKey(e) {
    if (e.key === 'Escape' && !this.#list.hidden) {
      e.preventDefault();
      e.stopPropagation(); // don't let it close the dialog as well
      if (!this.#free) this.#input.value = this.#text;
      this.#hide();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (this.#list.hidden) { this.#open(this.#input.value); return; }
      const n = this.#shown.length;
      if (!n) return;
      this.#active = (this.#active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
      this.#list.querySelectorAll('[data-value]').forEach((b, i) => {
        b.setAttribute('aria-selected', i === this.#active);
        if (i === this.#active) b.scrollIntoView({ block: 'nearest' });
      });
    } else if (e.key === 'Enter' && !this.#list.hidden && this.#shown[this.#active]) {
      e.preventDefault();
      e.stopPropagation();
      this.#choose(this.#shown[this.#active].value);
    }
  }
}

if (!customElements.get('item-search')) customElements.define('item-search', ItemSearch);
