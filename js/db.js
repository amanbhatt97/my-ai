// Local-first storage. Every record lives in IndexedDB on this device.
// Every change writes a history entry (before/after), so any change can be
// undone or any past version restored. Deletes go to Trash for 30 days.

const DB_NAME = 'lifetracker';
const DB_VERSION = 1;
const TRASH_DAYS = 30;

let idb;
const records = new Map();
const listeners = new Set();
const undoStack = [];

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function open() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      const rs = db.createObjectStore('records', { keyPath: 'id' });
      rs.createIndex('module', 'module');
      const hs = db.createObjectStore('history', { keyPath: 'id' });
      hs.createIndex('recordId', 'recordId');
      hs.createIndex('month', 'month');
      db.createObjectStore('blobs', { keyPath: 'id' });
      db.createObjectStore('kv', { keyPath: 'k' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function store(name, mode = 'readonly') {
  return idb.transaction(name, mode).objectStore(name);
}

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const now = () => new Date().toISOString();
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

// ── key/value settings ──────────────────────────────────────────────────
export async function kvGet(k, fallback = null) {
  const row = await req(store('kv').get(k));
  return row ? row.v : fallback;
}
export async function kvSet(k, v) {
  await req(store('kv', 'readwrite').put({ k, v }));
}

// ── blobs (audio) stay on this device ──────────────────────────────────
export async function putBlob(blob) {
  const id = uid();
  await req(store('blobs', 'readwrite').put({ id, blob, type: blob.type, at: now() }));
  return id;
}
export async function getBlob(id) {
  const row = await req(store('blobs').get(id));
  return row ? row.blob : null;
}

// ── init ───────────────────────────────────────────────────────────────
export async function init() {
  idb = await open();
  const all = await req(store('records').getAll());
  const cutoff = Date.now() - TRASH_DAYS * 864e5;
  for (const r of all) {
    if (r.deletedAt && Date.parse(r.deletedAt) < cutoff && !r.purged) {
      // keep a tombstone (so other devices learn about the delete) but drop the data
      r.data = {};
      r.purged = true;
      await req(store('records', 'readwrite').put(r));
    }
    records.set(r.id, r);
  }
  if (!(await kvGet('device'))) await kvSet('device', guessDevice());
}

function guessDevice() {
  const ua = navigator.userAgent;
  if (/iPhone|Android.*Mobile/.test(ua)) return 'Phone';
  if (/iPad|Android/.test(ua)) return 'Tablet';
  return 'Laptop';
}

// ── change notifications ───────────────────────────────────────────────
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function notify(info) { for (const fn of listeners) fn(info); }

// ── queries ────────────────────────────────────────────────────────────
export function get(id) { return records.get(id) || null; }
export function list(module) {
  const out = [];
  for (const r of records.values()) if (r.module === module && !r.deletedAt) out.push(r);
  return out;
}
export function all() {
  return [...records.values()].filter((r) => !r.deletedAt);
}
export function trash() {
  return [...records.values()].filter((r) => r.deletedAt && !r.purged);
}
export function allRaw() { return [...records.values()]; }

export async function historyFor(recordId) {
  const rows = await req(store('history').index('recordId').getAll(recordId));
  return rows.sort((a, b) => b.at.localeCompare(a.at));
}
export async function historyForMonth(month) {
  return req(store('history').index('month').getAll(month));
}
export async function allHistory() {
  return req(store('history').getAll());
}

// ── writes ─────────────────────────────────────────────────────────────
async function writeRecord(rec) {
  records.set(rec.id, rec);
  await req(store('records', 'readwrite').put(rec));
}

async function writeHistory(rec, action, before, after, beforeDeleted) {
  const at = now();
  const entry = {
    id: uid(),
    recordId: rec.id,
    module: rec.module,
    action,
    at,
    month: at.slice(0, 7),
    device: await kvGet('device', 'Device'),
    before: clone(before),
    after: clone(after),
    beforeDeleted: beforeDeleted || null,
  };
  await req(store('history', 'readwrite').put(entry));
  await markDirty(rec.module, entry.month);
  return entry;
}

async function markDirty(module, month) {
  const d = await kvGet('dirty', { modules: [], months: [] });
  if (!d.modules.includes(module)) d.modules.push(module);
  if (month && !d.months.includes(month)) d.months.push(month);
  await kvSet('dirty', d);
}

function pushUndo(item) {
  undoStack.push(item);
  if (undoStack.length > 50) undoStack.shift();
}

export async function create(module, data) {
  const t = now();
  const rec = { id: uid(), module, data: clone(data), createdAt: t, updatedAt: t, deletedAt: null };
  await writeRecord(rec);
  await writeHistory(rec, 'create', null, rec.data);
  pushUndo({ id: rec.id, before: null, beforeDeleted: null, label: 'Created' });
  notify({ type: 'create', rec });
  return rec;
}

export async function update(id, patch, { replace = false, silentUndo = false } = {}) {
  const rec = records.get(id);
  if (!rec) throw new Error('Record not found');
  const before = clone(rec.data);
  const after = replace ? clone(patch) : { ...before, ...clone(patch) };
  if (JSON.stringify(before) === JSON.stringify(after)) return rec;
  const next = { ...rec, data: after, updatedAt: now() };
  await writeRecord(next);
  await writeHistory(next, 'update', before, after);
  if (!silentUndo) pushUndo({ id, before, beforeDeleted: rec.deletedAt, label: 'Updated' });
  notify({ type: 'update', rec: next });
  return next;
}

export async function remove(id) {
  const rec = records.get(id);
  if (!rec) return;
  const next = { ...rec, deletedAt: now(), updatedAt: now() };
  await writeRecord(next);
  await writeHistory(next, 'delete', rec.data, rec.data, null);
  pushUndo({ id, before: rec.data, beforeDeleted: null, label: 'Deleted' });
  notify({ type: 'delete', rec: next });
}

export async function restoreFromTrash(id) {
  const rec = records.get(id);
  if (!rec) return;
  const next = { ...rec, deletedAt: null, updatedAt: now() };
  await writeRecord(next);
  await writeHistory(next, 'restore', rec.data, rec.data, rec.deletedAt);
  notify({ type: 'restore', rec: next });
}

// Restore a record to the state right after a given history entry.
export async function restoreVersion(entry) {
  const rec = records.get(entry.recordId);
  if (!rec) return;
  const target = entry.action === 'create' || entry.action === 'update' ? entry.after : entry.before;
  const next = { ...rec, data: clone(target), deletedAt: null, updatedAt: now() };
  await writeRecord(next);
  await writeHistory(next, 'revert', rec.data, next.data, rec.deletedAt);
  pushUndo({ id: rec.id, before: rec.data, beforeDeleted: rec.deletedAt, label: 'Restored' });
  notify({ type: 'update', rec: next });
}

export function canUndo() { return undoStack.length > 0; }

export async function undo() {
  const item = undoStack.pop();
  if (!item) return null;
  const rec = records.get(item.id);
  if (!rec) return null;
  let next;
  if (item.before === null) {
    // undo a create → move to trash
    next = { ...rec, deletedAt: now(), updatedAt: now() };
  } else {
    next = { ...rec, data: clone(item.before), deletedAt: item.beforeDeleted, updatedAt: now() };
  }
  await writeRecord(next);
  await writeHistory(next, 'undo', rec.data, next.data, rec.deletedAt);
  notify({ type: 'undo', rec: next });
  return item.label;
}

// ── sync helpers (used by sync.js) ─────────────────────────────────────
// Merge a remote record: newest updatedAt wins. Returns true if local changed.
export async function mergeRemoteRecord(remote) {
  const local = records.get(remote.id);
  if (local && local.updatedAt >= remote.updatedAt) return false;
  await writeRecord(remote);
  return true;
}

export async function mergeRemoteHistory(entry) {
  const exists = await req(store('history').get(entry.id));
  if (exists) return false;
  await req(store('history', 'readwrite').put(entry));
  return true;
}

export function notifyExternal() { notify({ type: 'sync' }); }

export async function importAll(payload) {
  let n = 0;
  for (const r of payload.records || []) if (await mergeRemoteRecord(r)) n++;
  for (const h of payload.history || []) await mergeRemoteHistory(h);
  const d = await kvGet('dirty', { modules: [], months: [] });
  for (const r of payload.records || []) if (!d.modules.includes(r.module)) d.modules.push(r.module);
  for (const h of payload.history || []) if (!d.months.includes(h.month)) d.months.push(h.month);
  await kvSet('dirty', d);
  notify({ type: 'import' });
  return n;
}
