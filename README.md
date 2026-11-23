# Life

A private, phone-first life tracker. Tasks, goals, reviews, decisions, jobs, health, money, things you own, documents, people, trips, a voice journal in Hinglish, and more: 48 sections, all searchable, all with full change history and undo.

- **Local-first:** works offline; data is stored on the device and saved instantly.
- **Encrypted sync:** syncs to a private GitHub repo, encrypted in the browser with your passphrase (AES-GCM, key derived with PBKDF2-SHA256, 600k iterations). GitHub only ever sees ciphertext.
- **History and undo:** every change is logged with before and after values, time and device. Undo any action, restore any past version, and deleted items stay in Trash for 30 days.
- **Heads up:** any date with a reminder (insurance, PUC, passport, birthdays, follow-ups, renewals) shows on the Now screen before it is due.
- **Voice journal:** tap the mic and speak Hindi, English or both. Audio is saved on the device straight away, then transcribed into Hinglish (Roman script) by your own Cloudflare Worker.
- **No build step:** plain HTML, CSS and JavaScript modules.

## Setup

### 1. Host the app (GitHub Pages)

GitHub Pages only works on **private** repos with a paid plan (Pro, Team or Enterprise). On the free plan, pick one:

- **A. Paid plan:** keep this repo private. Settings → Pages → Deploy from branch → `main`, folder `/ (root)`.
- **B. Free plan:** make this repo public; it only contains app code. Create a **separate private repo** (for example `my-life-data`) for the encrypted data, and point Sync at that repo.

Even on a paid plan, the Pages site URL itself is public. That's fine: the site holds no data, and your data only loads after you unlock it on your device.

The app will be at `https://<username>.github.io/<repo>/`. On your phone, open it and choose "Add to Home Screen" so it runs like an app.

### 2. Turn on encrypted sync

1. On GitHub: Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate.
   - Repository access: **only** the data repo.
   - Permissions: **Contents: Read and write**. Nothing else.
   - Set an expiry, and put a reminder for it in the app's Documents section.
2. In the app: Settings → Sync. Enter your username, the data repo, branch `data`, the token, and a passphrase (10+ characters).
3. Repeat step 2 on every device with the **same passphrase**.

Data is written to a separate `data` branch (`meta.json`, `records/<section>.json`, `history/<month>.json`), so it never mixes with the app code or gets published by Pages.

**If you forget the passphrase, the synced data cannot be recovered.** Keep it in a password manager, and use Settings → Export now and then for a backup (the export is *not* encrypted).

### 3. Voice transcription (optional)

The app records and saves voice notes without this. To get text, deploy the Worker in `worker/`, which holds your API keys so they never sit in the browser:

```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put APP_TOKEN          # any long random string
npx wrangler secret put SARVAM_API_KEY     # from sarvam.ai
npx wrangler secret put ANTHROPIC_API_KEY  # optional, for Hinglish cleanup + suggested tasks
npx wrangler deploy
```

Then, in the app, go to Settings → Voice transcription and paste the Worker URL and the same `APP_TOKEN`.

Before relying on it:
- Check `SARVAM_URL`, `SARVAM_MODEL`, `SARVAM_MODE` and the response field in `worker/src/index.js` against Sarvam's current docs. They were written from Sarvam's published API description and not tested against the live API.
- Set `ALLOWED_ORIGIN` in `worker/wrangler.toml` to your Pages origin.
- Set spending limits on your Sarvam and Anthropic accounts.
- Record a few real clips (work talk, family talk, names, a noisy place) and check the Hinglish quality.

Privacy note: voice audio and transcripts are sent to Sarvam (and to Anthropic if cleanup is on) to be processed. Everything stored afterwards is encrypted.

## Adding something new to track

Add an entry to `MODULES` in `js/schemas.js`. Lists, forms, search, history, sync and reminders all work automatically. Give a date field `remind: N` to have it show up in Heads up N days ahead.

## What's next

- Gmail: suggest job applications and status changes from your inbox (you confirm each one).
- Google Calendar: today's events on Now, and interview events linked to the matching job.
- Google Drive: attach files to any item; daily encrypted backup.
- AI help with decisions: ask questions across your own data.

## Files

```
index.html            app shell + bottom navigation
css/app.css           design
js/app.js             screens, routing, forms
js/schemas.js         every section and its fields
js/db.js              IndexedDB storage, history, undo, trash
js/crypto.js          encryption
js/sync.js            encrypted GitHub sync
js/journal.js         voice recording + transcription
sw.js                 offline support
worker/               Cloudflare Worker for speech-to-text and cleanup
```
