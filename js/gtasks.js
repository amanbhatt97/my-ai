// Google Tasks ⇄ app tasks.
//   In:  open Google Tasks (all lists) become app tasks (once; matched by id).
//   Out: tasks added in the app are created in your default Google Tasks list
//        (straight away when signed in, else at the next sync), and finishing
//        a linked task completes it in Google Tasks.

import * as db from './db.js';
import * as google from './google.js';

const API = 'https://tasks.googleapis.com/tasks/v1';

async function api(path, opts = {}) {
  const token = google.tokenFor(google.SCOPES.tasks);
  if (!token) throw Object.assign(new Error('Google sign-in expired. Tap sync again.'), { code: 'auth' });
  const res = await fetch(API + path, { ...opts, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  if (res.status === 401) { google.expire(); throw Object.assign(new Error('Google sign-in expired. Tap sync again.'), { code: 'auth' }); }
  if (res.status === 403) throw new Error('Google Tasks access was refused. Enable the Tasks API and add its scope (see the README).');
  if (!res.ok) throw new Error(`Google Tasks error ${res.status}`);
  return res.status === 204 ? {} : res.json();
}

export async function sync() {
  await google.signIn(google.SCOPES.tasks);
  const known = new Map(db.list('tasks').filter((t) => t.data.gtask).map((t) => [t.data.gtask.id, t]));
  let added = 0; let completed = 0;
  const lists = (await api('/users/@me/lists?maxResults=100')).items || [];
  for (const l of lists) {
    let pageToken = '';
    do {
      const j = await api(`/lists/${encodeURIComponent(l.id)}/tasks?showCompleted=false&showHidden=false&maxResults=100${pageToken ? `&pageToken=${pageToken}` : ''}`);
      for (const t of j.items || []) {
        if (!t.title || known.has(t.id)) continue;
        const due = t.due ? t.due.slice(0, 10) : '';
        await db.create('tasks', { title: t.title.trim(), status: due ? 'this week' : 'inbox', due, notes: t.notes || '', gtask: { id: t.id, list: l.id, listName: l.title } });
        added++;
      }
      pageToken = j.nextPageToken || '';
    } while (pageToken);
  }
  // push tasks added in the app while signed out or offline
  let pushed = 0;
  for (const t of db.list('tasks')) {
    if (t.data.gtaskPending && !t.data.gtask && t.data.status !== 'done') {
      try { if (await pushNew(t.id)) pushed++; } catch (e) { if (e.code === 'auth') throw e; }
    }
  }
  // push completions made in the app
  for (const t of db.list('tasks')) {
    if (t.data.status === 'done' && t.data.gtask && !t.data.gtask.completed) {
      try {
        await api(`/lists/${encodeURIComponent(t.data.gtask.list)}/tasks/${encodeURIComponent(t.data.gtask.id)}`, { method: 'PATCH', body: JSON.stringify({ status: 'completed' }) });
        await db.update(t.id, { gtask: { ...t.data.gtask, completed: true } }, { silentUndo: true });
        completed++;
      } catch (e) { if (e.code === 'auth') throw e; }
    }
  }
  await db.kvSet('gtasksLastSync', new Date().toISOString());
  return { added, completed, pushed };
}

// Called when a task is finished in the app; works if signed in, else waits for the next sync.
export async function completeIfLinked(id) {
  const t = db.get(id);
  if (!t?.data.gtask || t.data.gtask.completed || !google.hasToken(google.SCOPES.tasks)) return false;
  try {
    await api(`/lists/${encodeURIComponent(t.data.gtask.list)}/tasks/${encodeURIComponent(t.data.gtask.id)}`, { method: 'PATCH', body: JSON.stringify({ status: 'completed' }) });
    await db.update(id, { gtask: { ...t.data.gtask, completed: true } }, { silentUndo: true });
    return true;
  } catch { return false; }
}

// Create an app task in Google Tasks (default list). Returns true when created.
export async function pushNew(id) {
  const t = db.get(id);
  if (!t || t.module !== 'tasks' || t.data.gtask) return false;
  if (!google.hasToken(google.SCOPES.tasks)) { if (!t.data.gtaskPending) await db.update(id, { gtaskPending: true }, { silentUndo: true }); return false; }
  const body = { title: t.data.title || 'Task' };
  if (t.data.due) body.due = `${t.data.due}T00:00:00.000Z`;
  if (t.data.notes) body.notes = t.data.notes;
  const res = await api('/lists/%40default/tasks', { method: 'POST', body: JSON.stringify(body) });
  await db.update(id, { gtask: { id: res.id, list: '@default', listName: 'My Tasks' }, gtaskPending: false }, { silentUndo: true });
  return true;
}

// Re-open a linked task in Google Tasks when it is un-ticked in the app.
export async function reopenIfLinked(id) {
  const t = db.get(id);
  if (!t?.data.gtask || !t.data.gtask.completed || !google.hasToken(google.SCOPES.tasks)) return false;
  try {
    await api(`/lists/${encodeURIComponent(t.data.gtask.list)}/tasks/${encodeURIComponent(t.data.gtask.id)}`, { method: 'PATCH', body: JSON.stringify({ status: 'needsAction', completed: null }) });
    await db.update(id, { gtask: { ...t.data.gtask, completed: false } }, { silentUndo: true });
    return true;
  } catch { return false; }
}
