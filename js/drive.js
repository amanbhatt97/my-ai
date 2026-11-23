// Google Drive → Travel.
// Reads only file and folder NAMES (drive.metadata.readonly), never file contents.
// Each sub-folder of your destinations folder becomes a place. If it holds a
// passport stamp, visa, boarding pass, ticket or booking, it's marked travelled.

import * as db from './db.js';
import * as google from './google.js';

const API = 'https://www.googleapis.com/drive/v3/files';
const FOLDER = 'application/vnd.google-apps.folder';
// strong signs you actually went
const EVIDENCE = /(visa|e-?visa|boarding|board(ing)?[\s_-]?pass|e-?ticket|ticket|itinerary|booking|reservation|hotel|airbnb|flight|pnr|immigration|stamp|entry|arrival|departure|check-?in|passport)/i;

async function api(params) {
  const token = google.tokenFor(google.SCOPES.drive);
  if (!token) throw Object.assign(new Error('Google sign-in expired. Scan again.'), { code: 'auth' });
  const q = new URLSearchParams({ pageSize: '200', fields: 'files(id,name,mimeType,createdTime,modifiedTime,webViewLink)', ...params });
  const res = await fetch(`${API}?${q}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) { google.expire(); throw new Error('Google sign-in expired. Scan again.'); }
  if (res.status === 403) throw new Error('Drive access was refused. Add the Drive scope on the consent screen (see the README).');
  if (!res.ok) throw new Error(`Drive error ${res.status}`);
  return (await res.json()).files || [];
}

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const children = (id) => api({ q: `'${id}' in parents and trashed = false` });

export async function settings() {
  return { folder: 'Foreign Destinations', ...((await db.kvGet('drive')) || {}) };
}

export async function scan() {
  await google.signIn(google.SCOPES.drive);
  const { folder } = await settings();
  const roots = await api({ q: `name = '${esc(folder)}' and mimeType = '${FOLDER}' and trashed = false` });
  if (!roots.length) throw new Error(`No folder called "${folder}" found in your Drive.`);
  const places = [];
  for (const root of roots) {
    for (const f of await children(root.id)) {
      if (f.mimeType !== FOLDER) continue;
      // look one level deeper too (e.g. Japan/Tickets/…)
      let files = await children(f.id);
      for (const sub of files.filter((x) => x.mimeType === FOLDER)) files = files.concat(await children(sub.id));
      const evidence = files.filter((x) => x.mimeType !== FOLDER && EVIDENCE.test(x.name));
      const dates = evidence.map((x) => (x.createdTime || x.modifiedTime || '').slice(0, 10)).filter(Boolean).sort();
      places.push({
        driveId: f.id,
        place: f.name.trim(),
        link: f.webViewLink || `https://drive.google.com/drive/folders/${f.id}`,
        files: files.filter((x) => x.mimeType !== FOLDER).length,
        evidence: evidence.slice(0, 4).map((x) => x.name),
        travelled: evidence.length > 0,
        approxDate: dates[0] || '',
      });
    }
  }
  return places.sort((a, b) => (b.travelled - a.travelled) || a.place.localeCompare(b.place));
}

// Already imported? (matched by Drive folder or by place name)
export function existing(p) {
  const norm = (s) => (s || '').toLowerCase().trim();
  const all = [...db.list('trips'), ...db.list('travelwish')];
  return all.find((r) => r.data.driveId === p.driveId || norm(r.data.place) === norm(p.place)) || null;
}

export async function importPlace(p, travelled) {
  const note = p.evidence.length ? `From Drive. Found: ${p.evidence.join(', ')}` : 'From Drive.';
  if (travelled) {
    return db.create('trips', { place: p.place, from: p.approxDate || '', links: [p.link], highlights: '', driveId: p.driveId, notes: `${note}${p.approxDate ? '\nDate is a guess from the files; edit if wrong.' : ''}` });
  }
  return db.create('travelwish', { place: p.place, folder: p.link, driveId: p.driveId, notes: note });
}

// Flip a place between "travelled" (Trips) and "not yet" (Places to go).
export async function toggleTravelled(id) {
  const r = db.get(id);
  if (!r) return null;
  let rec;
  if (r.module === 'travelwish') {
    rec = await db.create('trips', { place: r.data.place, cost: r.data.budget || '', links: r.data.folder ? [r.data.folder] : [], driveId: r.data.driveId || '', notes: r.data.notes || '' });
  } else {
    rec = await db.create('travelwish', { place: r.data.place, folder: (r.data.links || [])[0] || '', driveId: r.data.driveId || '', notes: r.data.notes || '' });
  }
  await db.remove(id);
  return rec;
}
