// Voice journal. Audio is saved on this device first, so nothing is lost if
// the network or transcription fails. Recordings are split into ~25 s clips
// (each a complete audio file) because speech-to-text APIs limit clip length.

import * as db from './db.js';

const SEGMENT_MS = 25000;

function pickMime() {
  const options = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  for (const m of options) if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
  return '';
}

export function localStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export class Recorder {
  constructor() {
    this.segments = [];
    this.stream = null;
    this.rec = null;
    this.mime = pickMime();
    this.startedAt = 0;
    this.segTimer = null;
    this.stopping = false;
  }

  static supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    this.startedAt = Date.now();
    this._startSegment();
  }

  _startSegment() {
    const chunks = [];
    const rec = new MediaRecorder(this.stream, this.mime ? { mimeType: this.mime } : undefined);
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const done = new Promise((resolve) => {
      rec.onstop = () => {
        if (chunks.length) this.segments.push(new Blob(chunks, { type: rec.mimeType || this.mime || 'audio/webm' }));
        resolve();
      };
    });
    rec.start();
    this.rec = rec;
    this.recDone = done;
    this.segTimer = setTimeout(async () => {
      if (this.stopping) return;
      rec.stop();
      await done;
      if (!this.stopping) this._startSegment();
    }, SEGMENT_MS);
  }

  elapsed() { return Math.round((Date.now() - this.startedAt) / 1000); }

  async stop() {
    this.stopping = true;
    clearTimeout(this.segTimer);
    if (this.rec && this.rec.state !== 'inactive') this.rec.stop();
    await this.recDone;
    this.stream.getTracks().forEach((t) => t.stop());
    return { segments: this.segments, durationSec: this.elapsed() };
  }

  cancel() {
    this.stopping = true;
    clearTimeout(this.segTimer);
    try { if (this.rec && this.rec.state !== 'inactive') this.rec.stop(); } catch { /* ignore */ }
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
  }
}

// Save a finished recording as a journal entry, then transcribe in the background.
export async function saveRecording({ segments, durationSec }, kind) {
  const audio = [];
  for (const blob of segments) audio.push(await db.putBlob(blob));
  const rec = await db.create('journal', {
    at: localStamp(),
    kind,
    text: '',
    rawText: '',
    status: 'pending',
    audio,
    durationSec,
  });
  transcribe(rec.id);
  return rec;
}

export async function transcribe(id) {
  const cfg = await db.kvGet('voice', null);
  const rec = db.get(id);
  if (!rec) return;
  if (!cfg || !cfg.url) {
    await db.update(id, { status: 'no-transcriber' }, { silentUndo: true });
    return;
  }
  await db.update(id, { status: 'transcribing' }, { silentUndo: true });
  try {
    const parts = [];
    for (const blobId of rec.data.audio || []) {
      const blob = await db.getBlob(blobId);
      if (!blob) continue;
      const fd = new FormData();
      const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
      fd.append('file', blob, `clip.${ext}`);
      const res = await fetch(cfg.url.replace(/\/$/, '') + '/transcribe', {
        method: 'POST',
        headers: { 'X-App-Token': cfg.token || '' },
        body: fd,
      });
      if (!res.ok) throw new Error(`Transcription failed (${res.status})`);
      const j = await res.json();
      parts.push(j.text || '');
    }
    const raw = parts.join(' ').replace(/\s+/g, ' ').trim();
    let patch = { rawText: raw, text: raw, status: 'done' };
    if (cfg.cleanup !== false && raw) {
      try {
        const res = await fetch(cfg.url.replace(/\/$/, '') + '/cleanup', {
          method: 'POST',
          headers: { 'X-App-Token': cfg.token || '', 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: raw }),
        });
        if (res.ok) {
          const j = await res.json();
          if (j.text) patch.text = j.text;
          if (j.mood) patch.mood = j.mood;
          if (Array.isArray(j.people) && j.people.length) patch.people = j.people;
          if (Array.isArray(j.areas) && j.areas.length) patch.areas = j.areas;
          if (Array.isArray(j.tasks) && j.tasks.length) patch.suggestedTasks = j.tasks;
        }
      } catch { /* cleanup is optional; keep the raw transcript */ }
    }
    const latest = db.get(id);
    // never overwrite text the user typed while transcription was running
    if (latest && latest.data.text) delete patch.text;
    await db.update(id, patch, { silentUndo: true });
  } catch (e) {
    console.error(e);
    await db.update(id, { status: 'failed' }, { silentUndo: true });
  }
}

// Retry any entries left pending (e.g. recorded offline).
export async function retryPending() {
  for (const r of db.list('journal')) {
    if (['pending', 'failed', 'transcribing'].includes(r.data.status)) transcribe(r.id);
  }
}
