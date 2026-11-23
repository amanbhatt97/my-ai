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

// Must be called from a tap/click (browsers block sign-in popups otherwise).
export async function signIn(scope) {
  if (hasToken(scope)) return load().token;
  const id = await clientId();
  if (!id) throw new Error('Add your Google client ID in Settings first.');
  await loadGis();
  const prev = load();
  const wanted = [...new Set([...(prev?.scopes || []), scope])];
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: id,
      scope: wanted.join(' '),
      include_granted_scopes: true,
      callback: (resp) => {
        if (resp.error) { reject(new Error(resp.error_description || resp.error)); return; }
        const granted = (resp.scope || '').split(' ').filter(Boolean);
        if (!granted.includes(scope)) { reject(new Error('Permission was not granted.')); return; }
        save({ token: resp.access_token, scopes: granted, expiry: Date.now() + Number(resp.expires_in || 3600) * 1000 });
        resolve(resp.access_token);
      },
      error_callback: (err) => reject(new Error(err?.message || 'Google sign-in was closed.')),
    });
    client.requestAccessToken({ prompt: '' });
  });
}

// One consent for several features (Gmail, Calendar, Tasks, Drive).
export async function signInMany(scopes) {
  if (scopes.every((sc) => hasToken(sc))) return load().token;
  const id = await clientId();
  if (!id) throw new Error('Add your Google client ID in Settings first.');
  await loadGis();
  const prev = load();
  const wanted = [...new Set([...(prev?.scopes || []), ...scopes])];
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: id,
      scope: wanted.join(' '),
      include_granted_scopes: true,
      callback: (resp) => {
        if (resp.error) { reject(new Error(resp.error_description || resp.error)); return; }
        const granted = (resp.scope || '').split(' ').filter(Boolean);
        save({ token: resp.access_token, scopes: granted, expiry: Date.now() + Number(resp.expires_in || 3600) * 1000 });
        resolve(resp.access_token);
      },
      error_callback: (err) => reject(new Error(err?.message || 'Google sign-in was closed.')),
    });
    client.requestAccessToken({ prompt: '' });
  });
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
