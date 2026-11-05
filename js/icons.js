// Small line icons, drawn with currentColor so they follow the theme.

const svg = body => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const icons = {
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  phone: svg('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>'),
  mail: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'),
  truck: svg('<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>'),
  up: svg('<path d="m6 15 6-6 6 6"/>'),
  down: svg('<path d="m6 9 6 6 6-6"/>'),
  glass: svg('<path d="M7 3h10l-.5 6a4.5 4.5 0 0 1-9 0zM12 13.5V21M8.5 21h7M6.8 8h10.4"/>'),
  bottle: svg('<path d="M10 2h4v4.5l2 3V20a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V9.5l2-3zM8 13h8M8 17h8"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  grip: svg('<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>'),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>'),
  camera: svg('<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>'),
  back: svg('<path d="M15 6l-6 6 6 6"/>'),
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
};

// The 14 major allergens, one line icon each (keys as in ALLERGENS, lower case).
const ALLERGEN_ICONS = {
  celery: '<path d="M9 21V10M12 21V8M15 21V10"/><path d="M9 10C7 9 6 7 7 4c2 .5 3 3 2 6zM15 10c2-1 3-3 2-6-2 .5-3 3-2 6zM12 8c-1.6-1.6-1.6-4 0-6 1.6 2 1.6 4.4 0 6z"/>',
  gluten: '<path d="M12 22V8"/><path d="M12 8c-2-1-3-3-2-6 2 1 3 3 2 6zM12 8c2-1 3-3 2-6-2 1-3 3-2 6zM12 13c-2.5 0-4-1.5-4.5-4 2.5 0 4 1.5 4.5 4zM12 13c2.5 0 4-1.5 4.5-4-2.5 0-4 1.5-4.5 4zM12 18c-2.5 0-4-1.5-4.5-4 2.5 0 4 1.5 4.5 4zM12 18c2.5 0 4-1.5 4.5-4-2.5 0-4 1.5-4.5 4z"/>',
  crustaceans: '<path d="M7 7a7 7 0 0 1 12 5 6 6 0 0 1-6 6h-3l-3 3v-5"/><path d="M11 8.5l1 4.5M15 9.5l-1 4M7 7 4 4M7 7H3"/>',
  eggs: '<path d="M12 3c-3.5 0-6 5-6 9.5a6 6 0 0 0 12 0C18 8 15.5 3 12 3z"/>',
  fish: '<path d="M3 12c3-5 10-6 14-2l4-3v10l-4-3c-4 4-11 3-14-2z"/><circle cx="8" cy="11.5" r=".6"/>',
  lupin: '<path d="M12 22v-9"/><circle cx="12" cy="4" r="1.7"/><circle cx="9.3" cy="7.5" r="1.7"/><circle cx="14.7" cy="7.5" r="1.7"/><circle cx="12" cy="11" r="1.7"/>',
  milk: '<path d="M9 2h6v3l2 3v13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V8l2-3z"/><path d="M7 12h10"/>',
  molluscs: '<path d="M12 20 4 11a8 8 0 0 1 16 0z"/><path d="M12 20 8.5 6.5M12 20l3.5-13.5M12 20V4"/>',
  mustard: '<path d="M9 3h6v3H9z"/><path d="M8 6h8a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z"/><path d="M7 12h10"/>',
  'tree nuts': '<path d="M5 10a7 4 0 0 1 14 0z"/><path d="M6 10c0 6 3 10 6 11 3-1 6-5 6-11"/><path d="M12 6V3"/>',
  peanuts: '<path d="M12 3a4 4 0 0 0-4 4c0 1.6 1 2.4 1 3.5S7 12.6 7 15a5 5 0 0 0 10 0c0-2.4-2-3.4-2-4.5S16 8.6 16 7a4 4 0 0 0-4-4z"/>',
  sesame: '<path d="M8 3.5c-1.5 1.5-1.5 4 0 5.5 1.5-1.5 1.5-4 0-5.5zM16 3.5c-1.5 1.5-1.5 4 0 5.5 1.5-1.5 1.5-4 0-5.5zM12 9.5c-1.5 1.5-1.5 4 0 5.5 1.5-1.5 1.5-4 0-5.5zM7 15c-1.5 1.5-1.5 4 0 5.5 1.5-1.5 1.5-4 0-5.5zM17 15c-1.5 1.5-1.5 4 0 5.5 1.5-1.5 1.5-4 0-5.5z"/>',
  soya: '<path d="M4 18C4 10 10 4 18 4c2 0 2 2 2 2 0 8-6 14-14 14-2 0-2-2-2-2z"/><circle cx="9" cy="15" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="15" cy="9" r="1.4"/>',
  sulphites: '<text x="12" y="15.5" text-anchor="middle" font-size="9" font-weight="700" fill="currentColor" stroke="none" font-family="Montserrat, sans-serif">SO₂</text><circle cx="12" cy="12" r="9.5"/>',
};

/** Icon for an allergen name ("Milk", "tree nuts"); a "!" for one that isn't among the 14. */
export function allergenIcon(name) {
  const body = ALLERGEN_ICONS[String(name).trim().toLowerCase()]
    || '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.5"/>';
  return svg(body);
}

