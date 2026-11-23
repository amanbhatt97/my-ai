// Free speech-to-text using the browser's built-in recogniser (no keys, no Worker, no cost).
// Android Chrome sends the audio to Google's speech service; iPhone Safari uses Apple dictation.
// The app itself stores only the text.

const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
export const supported = () => !!SR;

export class Dictation {
  constructor({ lang = 'hi-IN', onUpdate, onState }) {
    this.lang = lang;
    this.onUpdate = onUpdate || (() => {});
    this.onState = onState || (() => {});
    this.finalText = '';
    this.active = false;
    this.rec = null;
  }

  start() {
    if (!SR) throw new Error('unsupported');
    this.active = true;
    this._open();
  }

  _open() {
    const rec = new SR();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) this.finalText = join(this.finalText, t);
        else interim = join(interim, t);
      }
      this.onUpdate(this.finalText, interim);
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { this.active = false; this.onState('denied'); }
      else if (e.error === 'network') { this.active = false; this.onState('network'); }
      // 'no-speech' and 'aborted' just end this round; onend restarts while active
    };
    // phones stop listening after a pause; keep going until the person presses Stop
    rec.onend = () => { if (this.active) { try { this._open(); } catch { this.active = false; this.onState('stopped'); } } else this.onState('stopped'); };
    this.rec = rec;
    rec.start();
    this.onState('listening');
  }

  pause() { this.active = false; try { this.rec?.stop(); } catch { /* already stopped */ } }

  setLang(lang) {
    this.lang = lang;
    if (this.active) { this.active = false; try { this.rec?.stop(); } catch { /* */ } setTimeout(() => { this.active = true; this._open(); }, 250); }
  }
}

function join(a, b) {
  b = (b || '').trim();
  if (!b) return a;
  if (!a) return b;
  return /[\s\n]$/.test(a) ? a + b : `${a} ${b}`;
}

// ── Devanagari → everyday Roman Hindi ("main aaj office gaya") ──────────
// Best effort, done on the phone. Spellings follow common chat style, not a formal scheme.
const VOWELS = { 'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ee', 'उ': 'u', 'ऊ': 'oo', 'ऋ': 'ri', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'ऑ': 'o', 'ऍ': 'e' };
const MATRAS = { 'ा': 'aa', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo', 'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॉ': 'o', 'ॅ': 'e' };
const CONS = {
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'n', 'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'n',
  'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n', 'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm', 'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v',
  'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h', 'ळ': 'l',
};
const NUKTA = { 'क': 'q', 'ख': 'kh', 'ग': 'g', 'ज': 'z', 'ड': 'r', 'ढ': 'rh', 'फ': 'f' };
const DIGITS = '०१२३४५६७८९';
// English words people say mid-sentence come back in Devanagari; spell the common ones normally
const LOAN = { ophis: 'office', baink: 'bank', phon: 'phone', mobail: 'mobile', laptop: 'laptop', projekt: 'project', intarvyoo: 'interview', intarvyu: 'interview', kampni: 'company', kampanee: 'company', kampani: 'company', mail: 'mail', vork: 'work', taim: 'time', plan: 'plan', haspital: 'hospital', doktar: 'doctor', gym: 'gym', jim: 'gym', vikend: 'weekend', sailri: 'salary', selri: 'salary', bas: 'bas' };

function wordToRoman(w) {
  // split into units: { c: consonant sound, v: vowel ('a' inherent, '' for virama, or explicit), x: trailing nasal/visarga }
  const units = [];
  const chars = [...w];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (CONS[ch]) {
      let c = CONS[ch];
      if (chars[i + 1] === '़') { c = NUKTA[ch] || c; i++; }
      const next = chars[i + 1];
      let v = 'a'; let explicit = false;
      if (next === '्') { v = ''; i++; } else if (MATRAS[next]) { v = MATRAS[next]; explicit = true; i++; }
      units.push({ c, v, explicit });
    } else if (VOWELS[ch]) {
      units.push({ c: '', v: VOWELS[ch], explicit: true });
    } else if (ch === 'ं' || ch === 'ँ') {
      if (units.length) units[units.length - 1].x = 'n'; else units.push({ c: '', v: '', x: 'n' });
    } else if (ch === 'ः') {
      if (units.length) units[units.length - 1].x = 'h';
    } else if (DIGITS.includes(ch)) {
      units.push({ raw: String(DIGITS.indexOf(ch)) });
    } else {
      units.push({ raw: ch === '।' ? '.' : ch === '॥' ? '.' : ch });
    }
  }
  // schwa deletion: drop the inherent "a" at the end of a word and in V C(a) C V positions
  const n = units.length;
  const hasV = (u) => u && !u.raw && u.v !== '';
  for (let i = 0; i < n; i++) {
    const u = units[i];
    if (u.raw || u.v !== 'a' || u.explicit || u.x) continue;
    const isLastCons = !units.slice(i + 1).some((x) => !x.raw);
    if (isLastCons && i > 0) { u.v = ''; continue; }
    if (i > 0 && hasV(units[i - 1]) && units[i + 1] && units[i + 1].explicit && !units[i + 1].raw && units[i + 1].c) u.v = '';
  }
  let out = units.map((u) => u.raw ?? `${u.c}${u.v}${u.x || ''}`).join('');
  // chat-style endings: gayaa → gaya, nahee → nahi
  out = out.replace(/aa\b/g, 'a').replace(/ee(n?)\b/g, 'i$1').replace(/n(?=[pbm])/g, 'm');
  return LOAN[out] || out;
}

export function hasDevanagari(s) { return /[ऀ-ॿ]/.test(s || ''); }

export function toRoman(text) {
  if (!hasDevanagari(text)) return text;
  return text.replace(/[ऀ-ॿ]+/g, (w) => wordToRoman(w));
}
