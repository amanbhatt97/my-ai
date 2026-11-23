// Cloudflare Worker that keeps API keys off the phone.
//   POST /transcribe  multipart "file" (one audio clip ≤ ~25 s) → { text }
//   POST /cleanup     { text } → { text, mood, people, areas, tasks }
//   POST /jobmail     { emails: [{id, from, subject, snippet, date}] } → { results }
//   POST /ask         { question, today, records: [{id, module, title, fields}] } → { answer, sources }
// Every request must carry the X-App-Token header matching the APP_TOKEN secret.
//
// One self-contained file with no dependencies, so it can be pasted straight into the
// Cloudflare dashboard's code editor (no npm, no command line). It calls the Claude API over
// HTTPS directly for that reason; the official SDK needs a build step the dashboard can't run.


const CLEANUP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['text', 'mood', 'people', 'areas', 'tasks'],
  properties: {
    text: { type: 'string' },
    mood: { type: ['integer', 'null'] },
    people: { type: 'array', items: { type: 'string' } },
    areas: { type: 'array', items: { type: 'string', enum: ['personal', 'office', 'career', 'health', 'money', 'people', 'learning', 'home', 'travel'] } },
    tasks: { type: 'array', items: { type: 'string' } },
  },
};

const SYSTEM = `You clean up voice-journal transcripts for one person who speaks a mix of Hindi and English.

Rewrite the transcript as readable Hinglish: Hindi words in Roman script, English words spelled as English. Keep the person's own words, tone and meaning. Add punctuation and paragraph breaks, remove filler sounds (umm, matlab repeated, etc.) and obvious repetitions. Do not summarise, translate fully into English, add facts or give advice. If a word is unclear, keep it as transcribed.

Also extract:
- mood: 1 (very low) to 5 (very good) if the entry clearly expresses one, else null.
- people: names or relations mentioned (e.g. "Mom", "Rahul").
- areas: which life areas the entry is about.
- tasks: short actionable to-dos the person says they need to do, written in the same Hinglish style. Empty if none.`;

// ── Claude API (Messages) over fetch ───────────────────────────────────
// Returns { ok: true, data } with the parsed JSON answer, or { ok: false, reason }.
async function claude(env, { system, content, schema, model }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2026-10-21',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
    },
    body: JSON.stringify({
      model: model || env.CLEANUP_MODEL || 'claude-opus-5-5',
      max_tokens: 16000,
      fallbacks: 'default', // if the model declines, the API retries on a fallback model in the same call
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
      system,
      messages: [{ role: 'user', content }],
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, reason: `Claude API ${res.status}: ${body?.error?.message || 'error'}` };
  if (body.stop_reason === 'refusal') return { ok: false, reason: 'refusal' };
  if (body.stop_reason === 'max_tokens') return { ok: false, reason: 'max_tokens' };
  const block = (body.content || []).find((b) => b.type === 'text');
  try { return { ok: true, data: JSON.parse(block.text) }; } catch { return { ok: false, reason: 'Bad AI response' }; }
}

function cors(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || 'https://amanbhatt97.github.io',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-App-Token',
    'Access-Control-Max-Age': '86400',
  };
}

function json(env, body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors(env) } });
}

async function transcribe(request, env) {
  const form = await request.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') return json(env, { error: 'Missing audio file' }, 400);
  if (file.size > 10 * 1024 * 1024) return json(env, { error: 'Clip too large' }, 413);

  const out = new FormData();
  out.append('file', file, file.name || 'clip.webm');
  out.append('model', env.SARVAM_MODEL || 'saaras:v3');
  out.append('mode', env.SARVAM_MODE || 'translit');

  const res = await fetch(env.SARVAM_URL || 'https://api.sarvam.ai/speech-to-text', {
    method: 'POST',
    headers: { 'api-subscription-key': env.SARVAM_API_KEY },
    body: out,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return json(env, { error: 'Speech-to-text failed', status: res.status, detail: body }, 502);
  return json(env, { text: body.transcript ?? body.text ?? '' });
}

async function cleanup(request, env) {
  const { text } = await request.json();
  if (!text || typeof text !== 'string') return json(env, { error: 'Missing text' }, 400);
  const plain = { text, mood: null, people: [], areas: [], tasks: [] };
  if (!env.ANTHROPIC_API_KEY) return json(env, plain);
  const r = await claude(env, { system: SYSTEM, schema: CLEANUP_SCHEMA, content: `<transcript>\n${text.slice(0, 50000)}\n</transcript>` });
  return json(env, r.ok ? r.data : plain);
}

const JOBMAIL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'is_job_email', 'company', 'role', 'status'],
        properties: {
          id: { type: 'string' },
          is_job_email: { type: 'boolean' },
          company: { type: 'string' },
          role: { type: 'string' },
          status: { type: ['string', 'null'], enum: ['applied', 'screening', 'interview', 'offer', 'rejected', null] },
        },
      },
    },
  },
};

const JOBMAIL_SYSTEM = `You read email metadata (sender, subject, preview) from one person's inbox and identify emails about that person's own job applications.

For each email return:
- is_job_email: true only if it is about an application this person made (confirmation, screening, interview, assessment, offer, rejection). Job alerts, newsletters, recruiter marketing and "jobs you may like" are false.
- company: the hiring company, not the applicant-tracking system or job board (Greenhouse, Lever, Workday, LinkedIn, Naukri are platforms, not employers). Empty if unknown.
- role: the job title if stated, else empty.
- status: applied (confirmation), screening (recruiter or HR call), interview (interview or assessment invite), offer, rejected; null if not a job email.`;

async function jobmail(request, env) {
  const { emails } = await request.json();
  if (!Array.isArray(emails) || !emails.length) return json(env, { results: [] });
  if (!env.ANTHROPIC_API_KEY) return json(env, { error: 'AI not configured' }, 501);
  const items = emails.slice(0, 25).map((e) => ({
    id: String(e.id), from: String(e.from || '').slice(0, 200), subject: String(e.subject || '').slice(0, 300), preview: String(e.snippet || '').slice(0, 400), date: String(e.date || ''),
  }));
  const r = await claude(env, { system: JOBMAIL_SYSTEM, schema: JOBMAIL_SCHEMA, content: `<emails>\n${JSON.stringify(items)}\n</emails>` });
  return r.ok ? json(env, r.data) : json(env, { error: r.reason === 'refusal' || r.reason === 'max_tokens' ? 'AI could not read these' : r.reason }, 502);
}

const ASK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'sources'],
  properties: {
    answer: { type: 'string' },
    sources: { type: 'array', items: { type: 'string' } },
  },
};

const ASK_SYSTEM = `You are the personal assistant inside one person's private life-tracker app. You answer their questions using only the records they have stored, which are given to you below.

How to answer:
- Answer in 1–3 short sentences, plain text, no markdown headings or bullet lists unless they ask for a list. Lead with the answer itself (a date, a name, a number, yes/no).
- Write in the language of the question: English if they ask in English, Hinglish (Hindi in Roman script mixed with English) if they ask that way.
- Work out dates relative to "today" given in the request: say "in 9 days" or "3 days ago" alongside the date.
- If the records don't contain the answer, say so plainly and say what they could add to the app so you can answer next time. Never guess or invent facts, names, dates or amounts.
- When asked for a brief or a summary of their week, cover what is due or overdue, upcoming birthdays and renewals, job applications that need follow-up, and people they haven't contacted in a long time. Keep it to about 5 short lines.
- sources: the ids of the records your answer relies on (at most 5). Empty if none.`;

async function ask(request, env) {
  const { question, today, records } = await request.json();
  if (!question || typeof question !== 'string') return json(env, { error: 'Missing question' }, 400);
  if (!env.ANTHROPIC_API_KEY) return json(env, { error: 'AI not configured' }, 501);
  const data = JSON.stringify(Array.isArray(records) ? records : []);
  if (data.length > 1_500_000) return json(env, { error: 'Too much data to send in one question' }, 413);
  const r = await claude(env, {
    model: env.ASK_MODEL || env.CLEANUP_MODEL,
    system: ASK_SYSTEM,
    schema: ASK_SCHEMA,
    content: [
      // the record set is identical across questions asked in a row, so it is cached
      { type: 'text', text: `<records>\n${data}\n</records>`, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: `Today is ${String(today || '').slice(0, 40)}.\n<question>\n${question.slice(0, 2000)}\n</question>` },
    ],
  });
  if (r.ok) return json(env, r.data);
  if (r.reason === 'refusal') return json(env, { answer: 'I can’t answer that one.', sources: [] });
  return json(env, { error: r.reason === 'max_tokens' ? 'Answer was cut off' : r.reason }, 502);
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env) });
    if (request.method !== 'POST') return json(env, { error: 'Not found' }, 404);
    if (!env.APP_TOKEN || request.headers.get('X-App-Token') !== env.APP_TOKEN) {
      return json(env, { error: 'Unauthorized' }, 401);
    }
    const { pathname } = new URL(request.url);
    try {
      if (pathname === '/transcribe') return await transcribe(request, env);
      if (pathname === '/cleanup') return await cleanup(request, env);
      if (pathname === '/jobmail') return await jobmail(request, env);
      if (pathname === '/ask') return await ask(request, env);
      return json(env, { error: 'Not found' }, 404);
    } catch (e) {
      return json(env, { error: e.message || 'Server error' }, 500);
    }
  },
};
