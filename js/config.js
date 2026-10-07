// App-wide configuration and the spreadsheet data model.

export const CONFIG = {
  CLIENT_ID: '415763317088-9hono52p2lh79eqqh1hsnssmksi7f1us.apps.googleusercontent.com',
  SPREADSHEET_ID: '1R0x7EhJSJffsopRgyzQKLFNUleFYEkDDxRmlmxh6ZE0',
  // Who the app lets in after Google sign-in: anyone on ALLOWED_DOMAIN, plus the named outside
  // addresses below (one per person, lower case). This is a courtesy check; real access is the
  // Google consent screen's user list and who the spreadsheet is shared with.
  ALLOWED_DOMAIN: 'conviviale.co.uk',
  ALLOWED_EMAILS: [
    'cat@thethirstycat.co.uk',
  ],
  // Sheets access, plus openid/email so we can check the signed-in account's domain.
  SHEETS_SCOPE: 'https://www.googleapis.com/auth/spreadsheets',
  SCOPES: 'https://www.googleapis.com/auth/spreadsheets openid email profile',
};

// One tab per entity. Row 1 = headers. Records link by ID, never by name.
// `numbers` / `booleans` drive type coercion on read and write; everything else is text.
export const SCHEMA = {
  SUPPLIERS: {
    idField: 'SUPPLIER_ID',
    idPrefix: 'SUP',
    headers: ['SUPPLIER_ID', 'NAME', 'CONTACT', 'EMAIL', 'PHONE', 'ORDER_DAYS', 'LEAD_TIME', 'MIN_ORDER'],
    numbers: ['LEAD_TIME', 'MIN_ORDER'],
  },
  // An ingredient is generic: what it is and how it's measured (UNIT: g / ml / each).
  // Prices live in SUPPLIER_PRICES. SUPPLIER_ID here is the *preferred* supplier; blank means
  // recipes use the cheapest price. Sheets created before price lists still carry old
  // SUPPLIER_CODE / PACK_* columns on this tab; the app no longer reads them after migrating.
  // Wines live here too, marked KIND = wine, so price lists, recipes (wine by the glass) and menus
  // treat them like any other ingredient. They get their own page and the wine-only columns
  // PRODUCER / VINTAGE / REGION / GRAPE / STYLE; they're measured in ml and priced by the bottle.
  INGREDIENTS: {
    idField: 'ING_ID',
    idPrefix: 'ING',
    headers: ['ING_ID', 'NAME', 'CATEGORY', 'UNIT', 'SUPPLIER_ID', 'YIELD_%', 'ALLERGENS', 'STORAGE',
      'SHELF_LIFE', 'ACTIVE', 'KIND', 'PRODUCER', 'VINTAGE', 'REGION', 'GRAPE', 'STYLE'],
    numbers: ['YIELD_%'],
    booleans: ['ACTIVE'],
  },
  // A supplier's price list: one row per supplier + ingredient + pack. PACK_UNIT is stored as
  // g / ml / each; UPDATED is the date the price was last set.
  SUPPLIER_PRICES: {
    idField: 'PRICE_ID',
    idPrefix: 'SP',
    headers: ['PRICE_ID', 'SUPPLIER_ID', 'ING_ID', 'SUPPLIER_CODE', 'PRODUCT_NAME', 'PACK_SIZE', 'PACK_UNIT',
      'PACK_PRICE', 'UPDATED'],
    numbers: ['PACK_SIZE', 'PACK_PRICE'],
  },
  PRICE_HISTORY: {
    headers: ['DATE', 'ING_ID', 'PACK_PRICE', 'INVOICE_REF', 'SUPPLIER_ID', 'PRICE_ID'],
    numbers: ['PACK_PRICE'],
  },
  RECIPES: {
    idField: 'RECIPE_ID',
    idPrefix: 'REC',
    headers: ['RECIPE_ID', 'NAME', 'TYPE', 'YIELD_QTY', 'YIELD_UNIT', 'PORTIONS', 'SELL_PRICE',
      'VAT_RATE', 'TARGET_GP%', 'METHOD'],
    numbers: ['YIELD_QTY', 'PORTIONS', 'SELL_PRICE', 'VAT_RATE', 'TARGET_GP%'],
  },
  // LINE_ID and SORT let a single line be edited, reordered or removed in place.
  RECIPE_LINES: {
    idField: 'LINE_ID',
    idPrefix: 'RL',
    headers: ['RECIPE_ID', 'ITEM_TYPE', 'ITEM_ID', 'QTY', 'UNIT', 'LINE_ID', 'SORT'],
    numbers: ['QTY', 'SORT'],
  },
  // A menu is a named list of recipes and how much of each an event or service needs. UNIT is
  // `portion` or a weight / volume unit of the recipe's batch yield. The shopping list is derived.
  MENUS: {
    idField: 'MENU_ID',
    idPrefix: 'MENU',
    headers: ['MENU_ID', 'NAME', 'NOTES'],
  },
  MENU_LINES: {
    idField: 'LINE_ID',
    idPrefix: 'ML',
    headers: ['LINE_ID', 'MENU_ID', 'RECIPE_ID', 'QTY', 'UNIT'],
    numbers: ['QTY'],
  },
  // A small photo per item (wines for now), kept as a JPEG data URL in IMAGE. See js/photos.js.
  PHOTOS: {
    idField: 'PHOTO_ID',
    idPrefix: 'PH',
    headers: ['PHOTO_ID', 'ING_ID', 'IMAGE', 'UPDATED'],
  },
};

export const RECIPE_TYPES = [['dish', 'Dish'], ['drink', 'Drink'], ['sub', 'Sub-recipe']];

// Used when a recipe leaves these blank.
export const RECIPE_DEFAULTS = { VAT_RATE: 20, TARGET_GP: 70 };

// UK FIR 14 major allergens.
export const ALLERGENS = ['Celery', 'Gluten', 'Crustaceans', 'Eggs', 'Fish', 'Lupin', 'Milk',
  'Molluscs', 'Mustard', 'Tree nuts', 'Peanuts', 'Sesame', 'Soya', 'Sulphites'];

export const ORDER_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const CATEGORY_SUGGESTIONS = ['Meat', 'Fish', 'Dairy', 'Cheese', 'Charcuterie', 'Veg', 'Fruit',
  'Herbs & spices', 'Dry goods', 'Oils & vinegars', 'Bakery', 'Wine', 'Spirits', 'Beer', 'Soft drinks',
  'Packaging'];

export const WINE_KIND = 'wine';
export const WINE_CATEGORY = 'Wine';
export const WINE_STYLES = ['Red', 'White', 'Rosé', 'Orange', 'Sparkling', 'Sweet', 'Fortified'];

export const STORAGE_SUGGESTIONS = ['Ambient', 'Chilled', 'Frozen', 'Cellar'];
