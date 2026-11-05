import { CONFIG, SCHEMA } from './config.js';
import * as auth from './auth.js';
import * as sheets from './sheets.js';
import * as store from './store.js';
import { toast, setReconnectHandler } from './ui.js';
import './item-search.js';
import { migrateToPriceLists, moveWinesToTab } from './migrate.js';
import { linkNames } from './link-names.js';
import * as ingredients from './views/ingredients.js';
import * as wines from './views/wines.js';
import * as suppliers from './views/suppliers.js';
import * as recipes from './views/recipes.js';
import * as menus from './views/menus.js';
import * as winemenus from './views/wine-menus.js';
import * as stock from './views/stock.js';

const ROUTES = { ingredients, wines, suppliers, recipes, menus, winemenus, stock };
// Routes without a tab of their own light up the tab they live under.
const NAV_FOR = { winemenus: 'menus', stock: 'wines' };
const DEFAULT_ROUTE = 'ingredients';

const $ = sel => document.querySelector(sel);
const screens = ['#loading', '#signin', '#fatal', '#app'];

function show(id, message) {
  screens.forEach(s => { $(s).hidden = s !== id; });
  if (id === '#loading' && message) $('#loading-msg').textContent = message;
}

function showSignin(message = '') {
  const el = $('#signin-msg');
  el.textContent = message;
  el.hidden = !message;
  $('#signin-btn').disabled = false;
  show('#signin');
}

function showFatal(message) {
  $('#fatal-msg').textContent = message;
  show('#fatal');
}

let currentRoute = null;

// Hash routes look like #/recipes or #/recipes/REC-0001 (the second part opens a record).
function route() {
  const [name = DEFAULT_ROUTE, param] = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const view = ROUTES[name || DEFAULT_ROUTE];
  if (!view) { location.hash = `#/${DEFAULT_ROUTE}`; return; }
  // Leaving a section closes anything it had open.
  if (currentRoute && currentRoute !== name) document.querySelectorAll('dialog[open]').forEach(d => d.close());
  currentRoute = name || DEFAULT_ROUTE;
  const tab = NAV_FOR[currentRoute] || currentRoute;
  document.querySelectorAll('.nav a[data-route]').forEach(a => {
    a.classList.toggle('active', a.dataset.route === tab);
    if (a.dataset.route === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  view.render($('#view'), param);
}

async function start() {
  try {
    show('#loading', 'Checking your account…');
    const user = await auth.fetchUser();
    if (!auth.isAllowed(user)) {
      auth.signOut({ revoke: true });
      showSignin(`You signed in as ${user.email}. Use your @${CONFIG.ALLOWED_DOMAIN} account, or ask to have this address added.`);
      return;
    }
    auth.rememberHint(user.email);
    $('#user-email').textContent = user.email;
    $('#user-initial').textContent = (user.given_name || user.email).trim().charAt(0);

    show('#loading', 'Preparing the spreadsheet…');
    const { createdTabs, addedColumns } = await sheets.ensureSchema(SCHEMA);

    show('#loading', 'Loading data…');
    await store.loadAll();
    const ided = await store.fillMissingIds();
    const linked = await linkNames();
    const moved = await moveWinesToTab();
    const migrated = await migrateToPriceLists();

    show('#app');
    $('#banner').hidden = true;
    route();
    if (createdTabs.length) toast(`Set up spreadsheet tabs: ${createdTabs.join(', ')}`);
    toastIds(ided);
    toastLinks(linked);
    if (moved.wines) toast(`Moved ${moved.wines} wine${moved.wines === 1 ? '' : 's'} to the WINES tab`);
    if (migrated.prices) toast(`Moved ${migrated.prices} ingredient price${migrated.prices === 1 ? '' : 's'} into supplier price lists`);
    const added = Object.entries(addedColumns);
    if (added.length) toast(`Added missing columns: ${added.map(([t, cols]) => `${t} (${cols.join(', ')})`).join('; ')}`);
  } catch (err) {
    console.error(err);
    if (err instanceof auth.AuthError) showSignin(err.message);
    else showFatal(err.message || String(err));
  }
}

/** Say which rows typed into the sheet were given IDs. */
function toastIds(filled) {
  const parts = Object.entries(filled).map(([tab, n]) => `${n} in ${tab}`);
  if (parts.length) toast(`Gave new rows added in the sheet their IDs: ${parts.join(', ')}`);
}

/** Say how many names typed into link columns were matched, and which weren't. */
function toastLinks({ fixed, unmatched }) {
  if (fixed) toast(`Matched ${fixed} name${fixed === 1 ? '' : 's'} typed into the sheet`);
  if (!unmatched.length) return;
  const list = unmatched.slice(0, 3).map(u => `“${u.value}” in ${u.tab} ${u.column} (${u.why})`).join('; ');
  const more = unmatched.length > 3 ? ` and ${unmatched.length - 3} more` : '';
  toast(`Couldn't match ${list}${more}. Fix the name in the sheet, or use the ID.`, 'error');
}

async function handleSignIn() {
  $('#signin-btn').disabled = true;
  try {
    await auth.signIn();
    await start();
  } catch (err) {
    showSignin(err.message);
  }
}

async function handleReconnect() {
  const btn = $('#reconnect-btn');
  btn.disabled = true;
  try {
    await auth.signIn();
    $('#banner').hidden = true;
    toast('Reconnected. You can carry on where you left off.');
    return true;
  } catch (err) {
    toast(err.message, 'error');
    return false;
  } finally {
    btn.disabled = false;
  }
}

async function handleRefresh() {
  const btn = $('#refresh-btn');
  btn.disabled = true;
  btn.classList.add('spinning');
  try {
    await store.loadAll();
    const ided = await store.fillMissingIds();
    const linked = await linkNames();
    route();
    toast('Data refreshed from the spreadsheet');
    toastIds(ided);
    toastLinks(linked);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.classList.remove('spinning');
  }
}

function handleSignOut() {
  $('.account').open = false;
  auth.signOut();
  document.querySelectorAll('dialog[open]').forEach(d => d.close());
  showSignin();
}

async function boot() {
  $('#sheet-link').href = `https://docs.google.com/spreadsheets/d/${CONFIG.SPREADSHEET_ID}/edit`;
  $('#signin-btn').addEventListener('click', handleSignIn);
  $('#reconnect-btn').addEventListener('click', handleReconnect);
  setReconnectHandler(handleReconnect);
  $('#refresh-btn').addEventListener('click', handleRefresh);
  $('#signout-btn').addEventListener('click', handleSignOut);
  $('#retry-btn').addEventListener('click', start);
  window.addEventListener('hashchange', () => { if (!$('#app').hidden) route(); });
  // Close the account menu when tapping anywhere else.
  document.addEventListener('click', e => {
    const menu = $('.account');
    if (menu.open && !menu.contains(e.target)) menu.open = false;
  });

  // Tokens last an hour. When one expires mid-session, keep the page (and any open form) as-is
  // and ask for a one-click reconnect instead of throwing the user back to the sign-in screen.
  auth.onExpired(() => { if (!$('#app').hidden) $('#banner').hidden = false; });

  try {
    await auth.init();
  } catch (err) {
    showFatal(err.message);
    return;
  }
  if (auth.getToken()) await start();
  else showSignin();
}

// ============================================================ updates for the installed app
// Installed on a phone, the app is rarely closed: switching back to it resumes the old page and
// there is no reload button, so a new release would never arrive. Whenever the app comes back on
// screen (and every 15 minutes while open) it asks GitHub for index.html and compares the release
// version. If there's a new one it reloads straight away, unless a form or the scanner is open;
// then it offers an Update button instead. The sign-in and unsent stock counts survive a reload.

const RUNNING_VERSION = new URL(document.querySelector('script[src*="js/main.js"]').src).searchParams.get('v');

async function checkForUpdate() {
  if (document.visibilityState !== 'visible' || navigator.onLine === false) return;
  let latest;
  try {
    const res = await fetch(`./index.html?check=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    latest = (await res.text()).match(/js\/main\.js\?v=([^"'&]+)/)?.[1];
  } catch {
    return; // no signal: try again next time
  }
  if (!latest || latest === RUNNING_VERSION) return;
  if (!document.querySelector('dialog[open]')) { location.reload(); return; }
  toast('A new version of the app is ready.', 'ok', { label: 'Update', onClick: () => location.reload() });
}

document.addEventListener('visibilitychange', checkForUpdate);
setInterval(checkForUpdate, 15 * 60 * 1000);

boot();
