# Conviviale Kitchen

Food cost, recipe management and (later) inventory for Conviviale wine bar.
Static single-page app: plain HTML/CSS/JS, no build step, served from the repo root on GitHub Pages.
Data lives in a Google Sheet, read and written directly from the browser with the Sheets API v4.

## Setup

1. **OAuth client** (Google Cloud Console → APIs & Services → Credentials, client
   `415763317088-9hono…`): add these under *Authorised JavaScript origins*:
   - `https://<github-user>.github.io` (the Pages origin, no path)
   - `http://localhost:8000` (local dev)
2. **Sheets API** must be enabled in the same Cloud project.
3. **Consent screen**: set user type to *Internal* so only @conviviale.co.uk accounts can sign in.
   The app also checks the domain after sign-in, but that check is a courtesy, not security.
   Real access control is who the spreadsheet is shared with.
4. **Share the spreadsheet** (edit access) with staff who should use the app.

On first sign-in the app creates any missing tabs (SUPPLIERS, INGREDIENTS, PRICE_HISTORY,
RECIPES, RECIPE_LINES) with headers. If a tab exists but is missing a column, the column is
appended at the end. Nothing is ever removed or reordered.

## Local development

ES modules need to be served over HTTP:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Layout

| File | Purpose |
| --- | --- |
| `js/config.js` | Client ID, spreadsheet ID, data model (tabs, headers, column types), allergen list |
| `js/auth.js` | Google Identity Services token client, domain check, session expiry |
| `js/sheets.js` | Sheets API wrapper: schema setup, read tables by header, append, update row by ID |
| `js/store.js` | In-memory cache, type coercion, ID generation (`SUP-0001`, `ING-0001`, `REC-0001`) |
| `js/costing.js` | Derived costs: unit cost, usable cost after yield, unit conversion |
| `js/ui.js` | Escaping, formatting, toasts, form dialog |
| `js/views/*.js` | One module per screen |
| `js/icons.js` | Line icons |
| `assets/` | Brand wordmarks, tree-ring pattern, paper and olive textures, home-screen icons |

## Brand

Follows the Conviviale brand guide: Aboreto (headings, uppercase) and Montserrat (text), both from Google Fonts.
Old Growth Olive `#5C5D46` is the primary colour, with Sage Lichen, Peeled Bark Cream, Maple Amber
(prices and accents) and Buvette Blush (allergen tags). The tree-ring pattern is used as a CSS mask,
so it can take any brand colour. Colours are defined as variables at the top of `css/app.css`.

The layout is designed for phones first: bottom tab bar, floating add button, card lists and
full-screen forms. It can be added to the home screen and opens like an app.

## Data rules

- Row 1 is headers. Columns are matched by header name, so you can reorder columns or add your
  own (e.g. NOTES) in the sheet. The app preserves them.
- Records link by ID, never by name.
- Only raw inputs are stored. Costs are computed in the app.
- Pack sizes are stored in `g`, `ml` or `each`. The form accepts kg, cl and L and converts them.
- Pack prices are ex VAT. Every price change (and each new ingredient) appends a row to
  PRICE_HISTORY with today's date and an optional invoice reference.
- Ingredients are retired by unticking ACTIVE rather than deleted, so recipes keep working.

## Roadmap

- **Phase 1 (done):** auth, Sheets wrapper, tab setup, suppliers and ingredients (list, search, add, edit).
- **Phase 2:** recipe builder: cost per portion, GP% vs target, allergens rolled up through sub-recipes.
  Wine by the glass is a recipe using a bottle ingredient (e.g. 175 ml of a 750 ml bottle).
- **Phase 3:** inventory: stock counts, deliveries, waste.
