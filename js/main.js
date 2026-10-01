import { CONFIG, SCHEMA } from './config.js';
import * as auth from './auth.js';
import * as sheets from './sheets.js';
import * as store from './store.js';
import { toast, setReconnectHandler } from './ui.js';
import * as ingredients from './views/ingredients.js';
import * as suppliers from './views/suppliers.js';

const ROUTES = { ingredients, suppliers };
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

function route() {
  const name = location.hash.replace(/^#\/?/, '') || DEFAULT_ROUTE;
  const view = ROUTES[name];
  if (!view) { location.hash = `#/${DEFAULT_ROUTE}`; return; }
  document.querySelectorAll('.nav a[data-route]').forEach(a => {
    a.classList.toggle('active', a.dataset.route === name);
    if (a.dataset.route === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  view.render($('#view'));
}

async function start() {
  try {
    show('#loading', 'Checking your account…');
    const user = await auth.fetchUser();
    if (!auth.isAllowed(user)) {
      auth.signOut({ revoke: true });
      showSignin(`You signed in as ${user.email}. Please use your @${CONFIG.ALLOWED_DOMAIN} account.`);
      return;
    }
    auth.rememberHint(user.email);
    $('#user-email').textContent = user.email;
    $('#user-initial').textContent = (user.given_name || user.email).trim().charAt(0);

    show('#loading', 'Preparing the spreadsheet…');
    const { createdTabs, addedColumns } = await sheets.ensureSchema(SCHEMA);

    show('#loading', 'Loading data…');
    await store.loadAll();

    show('#app');
    $('#banner').hidden = true;
    route();
    if (createdTabs.length) toast(`Set up spreadsheet tabs: ${createdTabs.join(', ')}`);
    const added = Object.entries(addedColumns);
    if (added.length) toast(`Added missing columns: ${added.map(([t, cols]) => `${t} (${cols.join(', ')})`).join('; ')}`);
  } catch (err) {
    console.error(err);
    if (err instanceof auth.AuthError) showSignin(err.message);
    else showFatal(err.message || String(err));
  }
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
    route();
    toast('Data refreshed from the spreadsheet');
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

boot();
