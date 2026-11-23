// Sync to a private GitHub repo. Everything is encrypted before upload.
// Layout on the data branch:
//   meta.json                 salt + KDF params + an encrypted check value
//   records/<module>.json     encrypted array of records for that module
//   history/<YYYY-MM>.json    encrypted array of history entries for that month
// Merge rule: newest updatedAt wins per record; history entries are append-only.

import * as db from './db.js';
import { deriveKey, encryptJSON, decryptJSON, newSalt, utf8ToB64, b64ToUtf8, KDF_ITERATIONS } from './crypto.js';

const API = 'https://api.github.com';
const CHECK = 'life-tracker-ok';

let syncing = false;
let timer = null;
let status = { state: 'off', message: 'Sync not set up', at: null };
const statusListeners = new Set();

export function onStatus(fn) { statusListeners.add(fn); fn(status); return () => statusListeners.delete(fn); }
function setStatus(state, message) {
  status = { state, message, at: new Date().toISOString() };
  for (const fn of statusListeners) fn(status);
}
export function getStatus() { return status; }

async function cfg() { return db.kvGet('sync', null); }

function gh(c) {
  const headers = {
    Authorization: `Bearer ${c.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const base = `${API}/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}`;
  return async (path, opts = {}) => {
    const res = await fetch(base + path, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
    if (res.status === 404) return { status: 404, body: null };
    let body = null;
    try { body = await res.json(); } catch { /* empty */ }
    if (!res.ok) {
      const err = new Error((body && body.message) || `GitHub error ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return { status: res.status, body };
  };
}

async function ensureBranch(api, c) {
  const b = await api(`/branches/${encodeURIComponent(c.branch)}`);
  if (b.status !== 404) return;
  // Create an orphan branch holding only a README, so data history stays separate from app code.
  const tree = await api('/git/trees', {
    method: 'POST',
    body: JSON.stringify({ tree: [{ path: 'README.md', mode: '100644', type: 'blob', content: '# Encrypted Life Tracker data\n\nEverything here is encrypted in the browser. Do not edit by hand.\n' }] }),
  });
  const commit = await api('/git/commits', {
    method: 'POST',
    body: JSON.stringify({ message: 'Create data branch', tree: tree.body.sha, parents: [] }),
  });
  await api('/git/refs', { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${c.branch}`, sha: commit.body.sha }) });
}

async function readFile(api, c, path) {
  const r = await api(`/contents/${path}?ref=${encodeURIComponent(c.branch)}`);
  if (r.status === 404) return null;
  let content = r.body.content;
  if (!content && r.body.sha) {
    // files over 1 MB come back without content; fetch the blob instead
    const blob = await api(`/git/blobs/${r.body.sha}`);
    content = blob.body.content;
  }
  return { sha: r.body.sha, json: JSON.parse(b64ToUtf8(content)) };
}

async function writeFile(api, c, path, json, sha, message) {
  const body = { message, content: utf8ToB64(JSON.stringify(json)), branch: c.branch };
  if (sha) body.sha = sha;
  const r = await api(`/contents/${path}`, { method: 'PUT', body: JSON.stringify(body) });
  return r.body.content.sha;
}

async function listDir(api, c, dir) {
  const r = await api(`/contents/${dir}?ref=${encodeURIComponent(c.branch)}`);
  if (r.status === 404 || !Array.isArray(r.body)) return [];
  return r.body.filter((x) => x.type === 'file').map((x) => ({ name: x.name, sha: x.sha, path: x.path }));
}

// ── setup ──────────────────────────────────────────────────────────────
// Connects to the repo, creates meta.json on first use, derives and stores the key.
export async function connect({ owner, repo, branch, token, passphrase }) {
  const c = { owner: owner.trim(), repo: repo.trim(), branch: (branch || 'data').trim(), token: token.trim() };
  const api = gh(c);
  setStatus('busy', 'Connecting…');
  const repoInfo = await api('');
  if (repoInfo.status === 404) throw new Error('Repo not found, or the token cannot see it.');
  if (repoInfo.body && repoInfo.body.private === false) {
    throw new Error('That repo is public. Use a private repo for your data.');
  }
  await ensureBranch(api, c);
  let meta = await readFile(api, c, 'meta.json');
  let key;
  if (meta) {
    key = await deriveKey(passphrase, meta.json.salt, meta.json.iterations);
    try {
      const v = await decryptJSON(key, meta.json.check);
      if (v !== CHECK) throw new Error();
    } catch {
      throw new Error('Wrong passphrase for this data.');
    }
  } else {
    const salt = newSalt();
    key = await deriveKey(passphrase, salt, KDF_ITERATIONS);
    const json = { v: 1, kdf: 'PBKDF2-SHA256', iterations: KDF_ITERATIONS, salt, check: await encryptJSON(key, CHECK) };
    await writeFile(api, c, 'meta.json', json, null, 'Initialise encrypted store');
    // first device: everything local needs uploading
    const d = { modules: [...new Set(db.allRaw().map((r) => r.module))], months: [...new Set((await db.allHistory()).map((h) => h.month))] };
    await db.kvSet('dirty', d);
  }
  await db.kvSet('sync', c);
  await db.kvSet('cryptoKey', key);
  await db.kvSet('shas', {});
  return syncNow();
}

export async function disconnect() {
  await db.kvSet('sync', null);
  await db.kvSet('cryptoKey', null);
  await db.kvSet('shas', {});
  setStatus('off', 'Sync not set up');
}

// ── sync ───────────────────────────────────────────────────────────────
export async function syncNow() {
  const c = await cfg();
  const key = await db.kvGet('cryptoKey');
  if (!c || !key) { setStatus('off', 'Sync not set up'); return; }
  if (!navigator.onLine) { setStatus('offline', 'Offline. Changes are saved on this device.'); return; }
  if (syncing) return;
  syncing = true;
  setStatus('busy', 'Syncing…');
  try {
    const api = gh(c);
    const shas = await db.kvGet('shas', {});
    const device = await db.kvGet('device', 'Device');
    let changed = false;

    // 1. pull anything that changed remotely
    for (const dir of ['records', 'history']) {
      for (const file of await listDir(api, c, dir)) {
        if (shas[file.path] === file.sha) continue;
        const remote = await readFile(api, c, file.path);
        const items = await decryptJSON(key, remote.json);
        for (const it of items) {
          if (dir === 'records') changed = (await db.mergeRemoteRecord(it)) || changed;
          else await db.mergeRemoteHistory(it);
        }
        shas[file.path] = remote.sha;
      }
    }
    await db.kvSet('shas', shas);
    if (changed) db.notifyExternal();

    // 2. push local changes (local is now a superset of remote)
    const dirty = await db.kvGet('dirty', { modules: [], months: [] });
    const message = `sync from ${device} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
    for (const module of dirty.modules) {
      const path = `records/${module}.json`;
      const items = db.allRaw().filter((r) => r.module === module);
      shas[path] = await pushWithRetry(api, c, key, path, items, shas[path], message, 'records');
    }
    for (const month of dirty.months) {
      const path = `history/${month}.json`;
      const items = await db.historyForMonth(month);
      shas[path] = await pushWithRetry(api, c, key, path, items, shas[path], message, 'history');
    }
    await db.kvSet('shas', shas);
    await db.kvSet('dirty', { modules: [], months: [] });
    await db.kvSet('lastSync', new Date().toISOString());
    setStatus('ok', 'Synced');
  } catch (e) {
    console.error(e);
    setStatus('error', e.status === 401 ? 'Token rejected. Update it in Settings.' : `Sync failed: ${e.message}`);
  } finally {
    syncing = false;
  }
}

async function pushWithRetry(api, c, key, path, items, sha, message, kind) {
  try {
    return await writeFile(api, c, path, await encryptJSON(key, items), sha, message);
  } catch (e) {
    if (e.status !== 409 && e.status !== 422) throw e;
    // someone else wrote this file: merge theirs into ours, then retry once
    const remote = await readFile(api, c, path);
    if (remote) {
      const theirs = await decryptJSON(key, remote.json);
      for (const it of theirs) {
        if (kind === 'records') await db.mergeRemoteRecord(it);
        else await db.mergeRemoteHistory(it);
      }
      db.notifyExternal();
      const merged = kind === 'records'
        ? db.allRaw().filter((r) => r.module === path.slice(8, -5))
        : await db.historyForMonth(path.slice(8, -5));
      return writeFile(api, c, path, await encryptJSON(key, merged), remote.sha, message);
    }
    return writeFile(api, c, path, await encryptJSON(key, items), null, message);
  }
}

// Debounced auto-sync after local edits.
export function scheduleSync(delayMs = 15000) {
  clearTimeout(timer);
  timer = setTimeout(() => syncNow(), delayMs);
}

export async function initSync() {
  const c = await cfg();
  if (c) {
    setStatus('idle', 'Ready');
    syncNow();
  }
  window.addEventListener('online', () => syncNow());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') syncNow();
  });
}
