# Conviviale Ops

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

## Releasing

GitHub Pages lets browsers cache files for 10 minutes. To stop a phone mixing a new page with
old cached scripts, every file link carries a version (`?v=…`). On each release, bump the version
in `index.html` (one search-and-replace), and add any new `js/` module to the import map there.

## Layout

| File | Purpose |
| --- | --- |
| `js/config.js` | Client ID, spreadsheet ID, data model (tabs, headers, column types), allergen list |
| `js/auth.js` | Google Identity Services token client, domain check, session expiry |
| `js/sheets.js` | Sheets API wrapper: schema setup, read tables by header, append, update row by ID |
| `js/store.js` | In-memory cache, type coercion, ID generation (`SUP-0001`, `ING-0001`, `REC-0001`) |
| `js/costing.js` | Derived costs: price-list unit costs, preferred-else-cheapest price, yield |
| `js/starter-ingredients.js` | Starter list of common wine-bar ingredients for the "Add many" screen |
| `js/migrate.js` | One-off data migrations run on load (single-supplier prices → price lists) |
| `js/pricelist-paste.js` | Parser for pasted supplier price lists |
| `js/units.js` | Recipe measurement families (weight / volume / each) and conversions |
| `js/recipe-cost.js` | Live recipe costing: line costs, sub-recipes, cost per portion, GP, allergen roll-up, loop guard |
| `js/recipe-paste.js` | Paste-a-recipe parser (ported from Carisma Ops) |
| `js/ui.js` | Escaping, formatting, toasts, form dialog |
| `js/views/*.js` | One module per screen; `prices.js` is the shared price-list entry form |
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
- Ingredients are generic: name, category, how they're measured (`UNIT`: g / ml / each), yield,
  allergens. Prices live in **SUPPLIER_PRICES**, one row per supplier + ingredient + pack, so an
  ingredient can have several suppliers (and a supplier several pack sizes).
- An ingredient's `SUPPLIER_ID` is its *preferred* supplier. Recipes use that supplier's price;
  if it's blank or the supplier has no price, the cheapest price per kg / L / each is used.
- Pack sizes are stored in `g`, `ml` or `each`. Forms accept kg, cl and L and convert them.
- Pack prices are ex VAT. Every new or changed price appends a row to PRICE_HISTORY with the date,
  supplier and an optional invoice reference.
- A supplier's price list can be pasted in (from a spreadsheet, email or PDF). Items already on
  their list, matched by product code or by ingredient and pack, get their price updated.
- Sheets created before price lists keep their old SUPPLIER_CODE / PACK_SIZE / PACK_UNIT /
  PACK_PRICE columns on INGREDIENTS. On first load those prices are copied into SUPPLIER_PRICES;
  after that the app ignores the old columns, and they can be deleted from the sheet.
- Ingredients are retired by unticking ACTIVE rather than deleted, so recipes keep working.
- RECIPE_LINES has two extra columns, `LINE_ID` and `SORT`, so a single line can be edited,
  reordered or removed in place. Lines added straight into the sheet without a LINE_ID still
  cost correctly but can only be edited in the sheet.
- Recipe costs are never stored. Cost per portion, GP and allergens are recalculated from the
  current ingredient prices every time, through any depth of sub-recipes.
- A recipe line's ITEM_TYPE is `ING` or `SUB`. Sub-recipes can be used by weight/volume (needs a
  batch yield) or by `portion` (needs PORTIONS). A sub-recipe that would loop back into the
  recipe can't be added.
- GP% is on the net price: SELL_PRICE is inc VAT, VAT_RATE defaults to 20% and TARGET_GP% to 70%.

## Roadmap

- **Phase 1 (done):** auth, Sheets wrapper, tab setup, suppliers and ingredients (list, search, add, edit).
- **Phase 2 (done):** recipe builder: cost per portion, GP% vs target, allergens rolled up through sub-recipes,
  scaling, paste importer. Wine by the glass is a drink recipe using a bottle ingredient (e.g. 175 ml of a 750 ml bottle).
- **Phase 3:** inventory: stock counts, deliveries, waste.
