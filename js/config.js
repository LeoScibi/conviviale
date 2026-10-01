// App-wide configuration and the spreadsheet data model.

export const CONFIG = {
  CLIENT_ID: '415763317088-9hono52p2lh79eqqh1hsnssmksi7f1us.apps.googleusercontent.com',
  SPREADSHEET_ID: '1R0x7EhJSJffsopRgyzQKLFNUleFYEkDDxRmlmxh6ZE0',
  ALLOWED_DOMAIN: 'conviviale.co.uk',
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
  INGREDIENTS: {
    idField: 'ING_ID',
    idPrefix: 'ING',
    headers: ['ING_ID', 'NAME', 'CATEGORY', 'SUPPLIER_ID', 'SUPPLIER_CODE', 'PACK_SIZE', 'PACK_UNIT',
      'PACK_PRICE', 'YIELD_%', 'ALLERGENS', 'STORAGE', 'SHELF_LIFE', 'ACTIVE'],
    numbers: ['PACK_SIZE', 'PACK_PRICE', 'YIELD_%'],
    booleans: ['ACTIVE'],
  },
  PRICE_HISTORY: {
    headers: ['DATE', 'ING_ID', 'PACK_PRICE', 'INVOICE_REF'],
    numbers: ['PACK_PRICE'],
  },
  RECIPES: {
    idField: 'RECIPE_ID',
    idPrefix: 'REC',
    headers: ['RECIPE_ID', 'NAME', 'TYPE', 'YIELD_QTY', 'YIELD_UNIT', 'PORTIONS', 'SELL_PRICE',
      'VAT_RATE', 'TARGET_GP%', 'METHOD'],
    numbers: ['YIELD_QTY', 'PORTIONS', 'SELL_PRICE', 'VAT_RATE', 'TARGET_GP%'],
  },
  RECIPE_LINES: {
    headers: ['RECIPE_ID', 'ITEM_TYPE', 'ITEM_ID', 'QTY', 'UNIT'],
    numbers: ['QTY'],
  },
};

// UK FIR 14 major allergens.
export const ALLERGENS = ['Celery', 'Gluten', 'Crustaceans', 'Eggs', 'Fish', 'Lupin', 'Milk',
  'Molluscs', 'Mustard', 'Tree nuts', 'Peanuts', 'Sesame', 'Soya', 'Sulphites'];

export const ORDER_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const CATEGORY_SUGGESTIONS = ['Meat', 'Fish', 'Dairy', 'Cheese', 'Charcuterie', 'Veg', 'Fruit',
  'Herbs & spices', 'Dry goods', 'Oils & vinegars', 'Bakery', 'Wine', 'Spirits', 'Beer', 'Soft drinks',
  'Packaging'];

export const STORAGE_SUGGESTIONS = ['Ambient', 'Chilled', 'Frozen', 'Cellar'];
