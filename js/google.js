// Shared Google sign-in (Google Identity Services, token model).
// Asks only for the scopes a feature needs, adds more later if another
// feature needs them, and keeps the short-lived token for this browser tab
// (sessionStorage) so a reload doesn't force a new sign-in.

import * as db from './db.js';

export const SCOPES = {
  gmail: 'https://www.googleapis.com/auth/gmail.readonly',
  calendar: 'https://www.googleapis.com/auth/calendar.events',
  drive: 'https://www.googleapis.com/auth/drive.metadata.readonly',
  tasks: 'https://www.googleapis.com/auth/tasks',
};

const KEY = 'google-token';
let mem = null;

function load() {
  if (mem) return mem;
  try { mem = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { mem = null; }
  return mem;
}
function save(t) {
  mem = t;
  try { sessionStorage.setItem(KEY, JSON.stringify(t)); } catch { /* private mode */ }
}

export function hasToken(scope) {
  const t = load();
  return !!(t && Date.now() < t.expiry - 60000 && (!scope || t.scopes.includes(scope)));
}

export function tokenFor(scope) {
  return hasToken(scope) ? load().token : null;
}

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load Google sign-in.'));
    document.head.appendChild(s);
  });
}

export async function clientId() {
  return ((await db.kvGet('gmail')) || {}).clientId || '';
}

// ── sign-in ─────────────────────────────────────────────────────────────
// Browsers only allow a popup if it opens *synchronously* inside the tap.
// So the Google script and client are prepared at app start (prepare()),
// and signIn() opens the popup with no waiting first. If a popup can't open
// (blocked, or an iPhone home-screen app), we use a full-page redirect.

let client = null;
let pending = null;
let readyId = '';

export async function prepare() {
  readyId = await clientId();
  if (!readyId) { client = null; return; }
  try {
    await loadGis();
    client = window.google.accounts.oauth2.initTokenClient({
      client_id: readyId,
      scope: SCOPES.calendar,
      include_granted_scopes: true,
      callback: (resp) => { const p = pending; pending = null; if (p) p.done(resp); },
      error_callback: (err) => { const p = pending; pending = null; if (p) p.fail(err); },
    });
  } catch { client = null; }
}

const isIosStandalone = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && (navigator.standalone || matchMedia('(display-mode: standalone)').matches);
// always the app's folder address, however the page was opened (…/my-ai/, …/my-ai/index.html)
export const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, '').replace(/([^/])$/, '$1/');
export const signInMode = () => (isIosStandalone() ? 'redirect' : 'popup');
export function tokenInfo() { const t = load(); return t ? { scopes: t.scopes || [], expiresIn: Math.round((t.expiry - Date.now()) / 60000) } : null; }
export function storedError() { try { return lastError || sessionStorage.getItem('google-last-error') || ''; } catch { return lastError; } }
export function recordError(msg) { lastError = msg; try { sessionStorage.setItem('google-last-error', msg); } catch { /* ignore */ } }

function redirectSignIn(scopes) {
  try { sessionStorage.setItem('google-return', location.hash || '#/now'); } catch { /* ignore */ }
  const q = new URLSearchParams({
    client_id: readyId,
    redirect_uri: redirectUri(),
    response_type: 'token',
    scope: scopes.join(' '),
    include_granted_scopes: 'true',
    prompt: '',
    state: 'life-google',
  });
  location.href = `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  return new Promise(() => {}); // the page is leaving
}

// Called at start-up: picks up the token when Google sends us back.
export let lastError = '';
export function consumeRedirect() {
  const h = location.hash;
  if (h.includes('error=') && h.includes('state=life-google')) {
    // Google sent us back with an error (denied, wrong setup…): remember it and show the app normally
    const params = new URLSearchParams(h.slice(1));
    lastError = `${params.get('error')}${params.get('error_description') ? `: ${params.get('error_description')}` : ''}`;
    try { sessionStorage.setItem('google-last-error', lastError); } catch { /* ignore */ }
    let back = '#/settings';
    try { back = sessionStorage.getItem('google-return') || back; sessionStorage.removeItem('google-return'); } catch { /* ignore */ }
    history.replaceState(null, '', location.pathname + back);
    return false;
  }
  if (!h.includes('access_token=')) return false;
  const params = new URLSearchParams(h.slice(1));
  if (params.get('state') !== 'life-google') return false;
  save({
    token: params.get('access_token'),
    scopes: (params.get('scope') || '').split(' ').filter(Boolean),
    expiry: Date.now() + Number(params.get('expires_in') || 3600) * 1000,
  });
  let back = '#/now';
  try { back = sessionStorage.getItem('google-return') || '#/now'; sessionStorage.removeItem('google-return'); } catch { /* ignore */ }
  history.replaceState(null, '', location.pathname + back);
  return true;
}

function request(scopes) {
  const prev = load();
  const wanted = [...new Set([...(prev?.scopes || []), ...scopes])];
  if (isIosStandalone()) return redirectSignIn(wanted);
  return new Promise((resolve, reject) => {
    pending = {
      done: (resp) => {
        if (resp.error) { recordError(`${resp.error}${resp.error_description ? `: ${resp.error_description}` : ''}`); reject(new Error(resp.error_description || resp.error)); return; }
        const granted = (resp.scope || '').split(' ').filter(Boolean);
        save({ token: resp.access_token, scopes: granted, expiry: Date.now() + Number(resp.expires_in || 3600) * 1000 });
        resolve(resp.access_token);
      },
      fail: (err) => {
        recordError(`popup: ${err?.type || err?.message || 'unknown'}`);
        if (err?.type === 'popup_failed_to_open') { redirectSignIn(wanted); return; }
        reject(new Error(err?.type === 'popup_closed' ? 'Google sign-in was closed.' : (err?.message || 'Google sign-in failed.')));
      },
    };
    client.requestAccessToken({ scope: wanted.join(' '), include_granted_scopes: true, prompt: '' });
  });
}

// Must be called straight from a tap: no awaits before it in the handler.
export function signIn(scope) { return signInMany([scope]); }

export function signInMany(scopes) {
  if (scopes.every((sc) => hasToken(sc))) return Promise.resolve(load().token);
  if (!readyId) return Promise.reject(new Error('Add your Google client ID in Settings first.'));
  if (!client) {
    // script not ready yet (slow network): prepare now, then the user taps again
    prepare();
    return Promise.reject(new Error('Google is still loading. Tap again in a second.'));
  }
  return request(scopes);
}

export function signOut() {
  const t = load();
  if (t && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(t.token, () => {});
  mem = null;
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}

export function expire() {
  mem = null;
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}
