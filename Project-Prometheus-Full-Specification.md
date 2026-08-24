# Project Prometheus — NCC ANO Assistance System
## Complete Project Specification & Handoff Document

This document is a complete, self-contained brief for building (or rebuilding) this project. It assumes no prior context — everything learned across the original build process is captured here, including mistakes made and fixed, so they aren't repeated.

---

## 1. What This Project Is

**Project Prometheus** is a training and administration portal for India's **National Cadet Corps (NCC)**. It serves two distinct user populations through one application:

- **Cadets**, who use a locked-down **Kiosk Mode** to study subjects, take timed exams, get AI help with doubts, and track their own progress.
- **ANOs (Associate NCC Officers)**, who use a **PC / Command Mode** to manage the cadet roster, attendance, unit finances, records, and event scheduling.

It is designed to run on a **shared physical device** (a "kiosk") that cadets check in and out of during a training session, alongside an administrative console the unit's officer uses.

### Who this is for
- Real NCC units running structured 40-minute training classes.
- A single shared device model where trust between users cannot be assumed (hence the security posture described below).
- Environments that may have **unreliable or no internet connectivity** (hence offline-first).

---

## 2. Foundational Architecture Decisions

These decisions were made deliberately and should be preserved unless there's a specific reason to change them:

### 2.1 Single HTML file, no build step
The entire application — markup, styles, and logic — lives in **one `.html` file**. No React, no bundler, no `npm install` required to run it. External libraries (Chart.js, jsPDF, pdf.js) are loaded via CDN `<script>` tags.

**Why**: this needs to be trivially portable — copyable to a USB stick, emailed, opened by double-clicking, or served from any static host — without anyone needing a development environment. A companion Node.js backend (see §7) is *optional* and only required for AI features.

**A parallel attempt to rebuild this as a proper multi-file React + Vite project was made and abandoned at the user's request** ("This is awful... go back to previous version"). The lesson: don't assume a "more proper" engineering architecture is what's wanted — this project's whole value proposition is its zero-dependency portability. If a real multi-file rebuild is wanted, say so explicitly; don't infer it from general engineering instinct.

### 2.2 Offline-first via IndexedDB
**IndexedDB is the single source of truth** for all persisted data (roster, finance, attendance, audit log, quiz attempts, uploaded PDFs, voice/language preferences). It works in any modern browser, requires no server, and requires no network.

A secondary, **best-effort mirror** to `window.storage` (a key-value API that only exists when this file is rendered inside a Claude.ai artifact preview) is attempted opportunistically when online, purely for cross-session convenience inside that specific preview context. **Never make `window.storage` a requirement for anything** — if it's absent (i.e., the file is opened normally, outside Claude.ai), the app must work exactly the same via IndexedDB alone. This was a real bug in an early version: the original code used `window.storage` as the *only* store, meaning the app silently persisted nothing at all when opened outside Claude.ai.

A sync queue tracks writes that couldn't reach the mirror while offline and retries them automatically when the `online` event fires.

### 2.3 Security model — be explicit about what's real and what isn't
This is the single most important section for anyone extending this project.

**Client-side RBAC is a UI convenience, not a security boundary.** The app has a central router (`goto(screen)`) that checks a role-permission map before rendering any screen, and it does correctly stop a cadet from ever having an ANO screen rendered into the DOM. But this is enforced entirely in browser JavaScript that anyone can read or modify via devtools. **If this project ever gains a real backend serving real financial or personal data over a network, that backend must independently re-verify every request's role — never trust a client-supplied role or token at face value.**

**The login system is a deliberate demo.** Typing any name and any 4-digit PIN logs you in; the "session token" it issues is a base64-encoded, unsigned JSON blob with an expiry, structurally similar to a JWT but **not cryptographically signed**. This is fine for a single shared kiosk device where the "threat model" is casual misuse, not fine for anything handling real people's real financial or personal data over a network. A reference implementation of *real* auth (bcrypt password hashing, signed JWTs, RBAC middleware) exists in the companion `server-reference.js` — see §7.

**"Secure Exam Mode" is a deterrent, not a guarantee.** It detects tab-switching, window blur, and fullscreen exit; blocks copy/paste, right-click, and text selection; and auto-submits after repeated violations. All of this can be defeated by someone with full control of their own machine (a second device, a VM, disabling JS). It meaningfully raises the bar against casual cheating on a shared device. It is not, and should never be marketed as, unbeatable. Pair it with actual proctoring policy for anything high-stakes.

**Never embed a real AI provider API key in this HTML file.** See §7 for the correct pattern (a small local backend holds the key; the browser never does). This was gotten wrong once already in this project's history — flagged and corrected before it shipped, but worth stating explicitly as a rule.

### 2.4 Content honesty
**Built-in subject content should never be presented as verified or authoritative unless it actually has been.** The original baseline content (see §4) was inherited from an earlier version of this project with no known provenance — no one could confirm it was sourced from an actual DGNCC handbook versus written from general knowledge. The subject *names and structure* (Health & Hygiene, Map Reading, Field Craft & Battle Craft, General Awareness) do match the real NCC syllabus taxonomy — that part was verified by web search. The *specific factual content inside* each note was never verified line-by-line and should be labeled as such in any UI that displays it, with a clear path for an ANO to load verified real content (see §6.6 — this is exactly what the local-PDF-loading feature is for).

---

## 3. User Roles & Screens

Two modes, chosen at login:

| Mode | Internal name | Who | Devices |
|---|---|---|---|
| Cadet Kiosk | `kiosk` | Cadets | Shared kiosk device |
| PC / Command | `pc` | ANO officers | Officer's own device, or the same kiosk |

### Cadet-facing screens
- **Dashboard** — subject tiles, upcoming events teaser, doubt-clearing hint, PDF vault teaser.
- **Subject Home** (per subject) — the 4-module session launcher, progress card, restart control, PDF export buttons.
- **Session** (the 4 modules — see §5).
- **Session Complete** — summary, PDF download, return-to-dashboard.
- **PDF Vault** — shared with ANO; upload/summarize/query custom PDFs.
- **Calendar** (view-only for cadets).

### ANO-facing screens
- **Command Dashboard** — roster/finance/syllabus snapshot, quick actions, Architecture Notes link, AI backend test, local-PDF loader.
- **Cadet Roster & Analytics** — per-cadet radar chart, editable roster status, attendance shortcut.
- **Finance & Syllabus** — expenditure log (add/edit/delete) and per-subject syllabus completion with restart controls.
- **Records & Archives** — tabs for Attendance (with camp-status override), Document Repository, Achievements Register, and Audit Trail.
- **Events & Roll Call** — calendar plus a "Smart Biometric Roll Call" simulation, session/class-scoped.

### Route access table (enforce centrally, fail-closed for anything not listed)
```
pc-dashboard     -> pc only
kiosk-dashboard  -> kiosk only
subject-home     -> pc, kiosk
session          -> pc, kiosk
session-complete -> pc, kiosk
pdf-vault        -> pc, kiosk
pc-finance       -> pc only
pc-roster        -> pc only
pc-records       -> pc only
pc-events        -> pc, kiosk (read-only parts differ by role within the screen)
```

---

## 4. Subject & Content Data Model

Four subjects, matching real NCC syllabus categories:

| Key | Name | Icon | Accent |
|---|---|---|---|
| `HH` | Health & Hygiene | ⛑️ | emerald |
| `MR` | Map Reading | 🧭 | blue |
| `FCBC` | Field Craft & Battle Craft | 🌿 | emerald |
| `GA` | General Awareness & Armed Forces | 🎖️ | blue |

Each subject has:
- `notes`: an array of `{heading, body}` chapter entries (baseline is ~6 per subject).
- `quiz`: an array of `{q, options[4], correct, rationale}`.
- `flashcards`: an array of `{term, def}`.

### Content sourcing — four possible origins, always labeled
A subject's `notes` can come from, and the UI must always show which:
1. **Standard Curriculum** — the built-in baseline (unverified — see §2.4).
2. **AI-Generated** — regenerated live by an LLM call, session-scoped, not persisted as the new baseline.
3. **Translated** — AI-translated into the selected non-English language, cached per (chapter, language).
4. **From Subject PDFs** — extracted from real PDFs an ANO supplied (see §6.6). This is the recommended path for anything used in real instruction.

### "Digestible parts" — chunking within Module 1
Rather than showing all of a subject's notes in one long scroll, Module 1 auto-groups them into 3–4 roughly-even "Parts" (Part A/B/C...), each with its own reading progress indicator and its own TTS playback (see §5, Module 1). Grouping logic: if 4 or fewer notes, one part per note; otherwise, split into 3 groups of `ceil(count/3)`.

---

## 5. The 40-Minute Class Engine — 4 Modules, Strictly Timed

Every subject session is a **fixed, standardized 2400-second (40-minute) sequence** of exactly 4 modules. Durations are a **single named constant set**, not scattered magic numbers, so every UI label stays consistent if ever changed:

```
Module 1 — Theory, Audio & Flashcards   20 min (1200s)
Module 2 — Secure Exam Drill            10 min (600s)
Module 3 — Answer Discussion             5 min (300s)
Module 4 — Doubt Clearing (AI)           5 min (300s)
```

### Module 1 — Theory, Audio & Flashcards
- Tabs: Lecture Notes (chunked into Parts, see §4), Flashcards, Diagrams.
- **Audio player** driving Web Speech API TTS over the current Part's text:
  - Controls: restart-part, skip +/-1 line, play/pause, stop, seek bar (click/drag to jump anywhere), rate selector (0.75x-1.5x), **voice picker** (see below).
  - **Critical technical detail — sentence splitting must be Unicode-aware.** A naive `/[^.!?]+[.!?]+/` regex only recognizes Latin punctuation. Hindi (and Sanskrit-derived scripts) end sentences with the Devanagari danda `।` or `॥`, which that regex never matches — so translated text with no ASCII punctuation collapses into one giant utterance, which is exactly what browser TTS engines tend to truncate or silently drop. **The splitter must match `[^.!?।॥]+[.!?।॥]+` and additionally hard-wrap (by commas, then by words) any resulting chunk still longer than ~180-220 characters**, so no single utterance is ever too long regardless of script or punctuation style.
  - **Chrome/Edge bug workaround**: `speechSynthesis` silently pauses the queue after ~15 seconds of a backgrounded/idle tab. Run a `setInterval` every ~12s while "playing" that calls `pause(); resume();` to keep it alive.
  - **Voice quality**: browsers default to whatever voice happens to be first for a locale, which is frequently the flattest/most robotic option. Enumerate `speechSynthesis.getVoices()` filtered by language, rank candidates by name-matching against quality hints (`neural`, `natural`, `premium`, `enhanced`, `google`, `wavenet`, `online`; penalize `compact`/`espeak`), and let the user override the pick explicitly via a dropdown. Persist the choice per language.
  - Handle `onerror` on utterances by advancing to the next line instead of silently stopping playback.
- "Regenerate with AI" button re-generates that subject's notes live (session-scoped, not persisted as the new baseline).

### Module 2 — Secure Exam Drill
- A 5-question multiple-choice quiz.
- **While active**: fullscreen requested; `visibilitychange`/`blur`/`fullscreenchange` tracked as violations; `contextmenu`/`copy`/`cut`/`paste`/`selectstart` prevented; common devtools key combinations blocked; all navigation away from this screen blocked (central `goto()` guard) except finishing the quiz.
- A live banner shows violation count out of a max (3). Hitting the max **force-submits** whatever was answered and flags the attempt as auto-submitted.
- Every violation and the final submission are written to the audit trail.
- On submit: exit secure mode, grade the attempt, log it, advance to Module 3.
- See §2.3 for the honest limits of this mechanism.

### Module 3 — Answer Discussion
- Every question shown again with the cadet's answer, the correct answer, and a written rationale, marked Correct/Incorrect.

### Module 4 — Doubt Clearing (AI)
- A chat interface, context-primed with that subject's notes, answering cadet questions.
- Must respond in whichever language is currently selected app-wide, not always English (a real bug: the system prompt must include an explicit language instruction).
- On failure, the fallback message must be **accurate to the actual cause** — not a hardcoded "offline mode" string shown even when the browser is online and the real cause is an unreachable AI backend. See §7 for correct error messaging.

### Instructor overrides
An ANO viewing a session can jump directly to any module via the module stepper, regardless of the timer — this is a deliberate, always-available manual override, distinct from and independent of the automatic phase-advance-on-timeout behavior.

### "Restart Subject" — progress reset
A subject's syllabus percentage and quiz-attempt history can be reset to a true 0%/empty state at any time. This control should be placed **everywhere the percentage itself is shown** — the original build initially only put it on the subject's own page and users couldn't find it when looking at the number on the ANO's Finance & Syllabus screen instead. Put a "Restart" affordance next to every rendering of that percentage, not just one canonical place.

**Important nuance on what the percentage actually measures**: unless deliberately redesigned, this is a synthetic counter — a per-subject seed value that increases by a flat +4 percentage points per submitted quiz attempt (capped at 100), **not** a measure of chapters actually read or quiz *score*. If a more meaningful metric is wanted (e.g., weighted by score, or driven by actual chapter-read checkmarks), that's a real design change, not a config tweak — say so explicitly if that's what's wanted.

---

## 6. Administrative Features (ANO / PC Mode)

### 6.1 Cadet Roster
- List with status badges (Active / New Joinee / In Camp / Dropout).
- Clicking a cadet opens a detail modal showing a subject-performance radar chart and **an editable status dropdown** — this must save immediately and write to the audit trail. (A real gap in an earlier version: the status was shown as a read-only badge with no way to ever change it after initial creation.)
- A link from the cadet modal through to day-to-day attendance marking, since "cadet status" and "today's attendance" are two different concepts that live in different screens and both plausibly answer "how do I change a cadet's status."

### 6.2 Attendance & Camp Status
Two independent but connected mechanisms — the underlying data model is one record per **(cadetId, date, subject)** triple, deliberately never locked, so any past session's status for any class can always be revisited and corrected, and a *later* class on the same day gets its own independent record rather than overwriting the first:

- **Status values**: `present`, `absent`, `excused`, `on_duty`.
- **Manual override form** (Records & Archives -> Attendance): pick any cadet, any date, any subject/"General," any status, apply — creates or updates the matching record.
- **Biometric Roll Call simulation** (Events & Roll Call): a per-class/subject selector plus a grid of cadets; "Scan" defaults to Present, with quick A/E/D (Absent/Excused/On-Duty) buttons for cadets not yet marked, and an inline status dropdown for cadets already marked, so nothing here is a one-way action either.
- Every status change is audit-logged with before -> after values.

### 6.3 Finance
- Expenditure log: date, category, description, amount.
- **Add, edit, and delete** must all exist — an earlier version only had add/delete, a real functional gap.
- Every add/edit/delete is audit-logged.

### 6.4 Records & Archives
Four tabs: Attendance (§6.2), Document Repository (freeform indexed records), Achievements Register, and **Audit Trail** — a reverse-chronological, searchable-by-eye log of every administrative action, login/logout, blocked access attempt, and exam-integrity event, each with actor, role, timestamp, and a short description.

### 6.5 Events & Roll Call
Calendar (shared, read-only for cadets) plus the biometric roll call simulation described in §6.2.

### 6.6 Loading Real Subject Content from Local PDFs
This is the mechanism for replacing the unverified baseline content (§2.4) with real, ANO-supplied material (e.g., actual scanned/exported DGNCC handbook chapters).

**Browsers cannot silently read an arbitrary local folder** — there is no such API for security reasons. Two real, working paths exist, and both should be implemented; neither alone is sufficient for every deployment scenario:

**Path A — folder picker (File System Access API), user-triggered.**
An ANO clicks a button, the browser's native folder picker opens, they select a local folder structured as:
```
Subjects/
  HH/              (folder name can be the subject key OR its full name, matched flexibly)
    chapter1.pdf
    chapter2.pdf
  MR/ ...  FCBC/ ...  GA/ ...
```
Every `.pdf` in each matched subfolder is read and text-extracted (see §6.7 for the extraction pipeline itself), one note entry per file, sorted by filename (so name chapters so they sort in the order you want, e.g. `chapter1-`, `chapter2-` not `intro`/`advanced`).

*Real constraint*: this API only exists in Chromium browsers (Chrome, Edge), requires a genuine user click, and is **commonly blocked entirely inside sandboxed or embedded preview iframes** — including, notably, some preview panes used to test this very file. Detect its absence and say so plainly rather than failing silently.

**Path B — manifest.json + fetch, automatic and silent.**
If this file is served over `http(s)://` (a real or local web server — not opened as a bare `file://` document), the app automatically checks `Subjects/<KEY>/manifest.json` for each subject at startup. That file is just a JSON array of filenames:
```json
["chapter1-personal-hygiene.pdf", "chapter2-food-water-hygiene.pdf"]
```
Each listed file is fetched relative to that same folder and processed identically to Path A. This works in *any* browser, needs no permission prompt, and should fail completely silently if nothing is found (this is an opportunistic enhancement, not a requirement — a missing `Subjects/` folder is not an error).

**Quality-gated fallback (important — this prevents a real failure mode)**: real official documents are often large, only partially scanned, or inconsistently formatted. A batch load must **not** apply its result unless at least half the attempted files produced substantial real text (a minimum length threshold, e.g. 150+ characters, to reject stray headers/watermarks leaking through mostly-scanned pages). If the batch doesn't clear that bar, **reject the whole batch and leave whatever content was already active untouched** — never partially overwrite good content with an incomplete result. Report exactly which files failed and why (no text found / too little text found / a read error) so the ANO knows what to re-scan or re-export.

**Reversibility**: stash the previous content before overwriting it, and provide an explicit "revert to built-in content" control once local content is active, per subject.

### 6.7 PDF Text Extraction Pipeline (shared by Custom PDF Vault and §6.6)
Uses `pdf.js` (loaded via CDN, e.g. `cdnjs.cloudflare.com/ajax/libs/pdf.js/<version>/pdf.min.js`). Two hard-won lessons:

1. **Worker loading order matters and is environment-dependent.** pdf.js normally parses in a background Web Worker. Pointing the worker straight at a cross-origin CDN URL can trigger a browser security restriction, causing pdf.js to fall back to a slower, less reliable in-page "fake worker" (visible in devtools as `Warning: Setting up fake worker`). A "fix" of proactively loading the worker from a `blob:` URL was tried and made things *worse* in one real tested environment — that environment rewrote `blob:` URLs into a non-standard scheme (`blob-request://`) that couldn't be loaded as a script at all, turning a harmless warning into a hard crash. **The corrected, evidence-based approach**: try the direct CDN URL first (matches observed safer behavior); only attempt the blob-URL rewrite as a fallback if the direct attempt genuinely fails to open a document; if both fail, surface a clear, specific error rather than hanging. **Lesson generalized: when a "theoretically better" fix is tried and the user reports it made things worse, believe the evidence over the theory and revert the priority — don't layer a third patch on top of a wrong assumption.**
2. **Add a timeout to every extraction step** (opening the document, getting each page, extracting each page's text) — 15-20 seconds is reasonable. Without this, a hung `fake worker` or a malformed PDF can leave the UI stuck on a loading toast forever with no explanation.
3. **Detect scanned/image-only PDFs explicitly.** If extracted text is empty (or under the same ~150-character quality threshold as §6.6), tell the user directly that this looks like a scanned image with no OCR support, rather than silently producing an empty, useless result.

---

## 7. AI Integration Architecture

### 7.1 The core rule
**No AI provider API key may ever be embedded in the browser-side code of this file.** Anyone can open devtools, view page source, or just read the file in a text editor. This matters especially here because the deployment target is explicitly a **shared kiosk device** — an unattended API key is a standing invitation for a curious cadet to extract and abuse it.

### 7.2 The two-path calling strategy
The app's single AI-calling function should try, in order:

1. **A local backend the ANO runs themselves**, e.g. `http://localhost:8787/api/ai/generate` — configurable via a clearly-labeled constant near the top of the script. This backend holds the real API key server-side (in a `.env` file, never committed) and is what makes AI features work with the file opened completely standalone, with no dependency on any particular hosting platform.
2. **A direct call to Anthropic's API with no key** (`fetch('https://api.anthropic.com/v1/messages', ...)`), which **only succeeds inside a Claude.ai artifact preview**, where the key is injected transparently by the platform itself. This is a legitimate fallback so the same file still works if it's ever opened inside that specific context, but it is not something to rely on for standalone use.

Both paths should normalize their response into the same shape (e.g., `{content: [{type: 'text', text: '...'}]}`) so the rest of the application's ~10 different AI-calling functions (notes generation, quiz generation, translation, doubt-answering, PDF summarization) never need to know or care which path actually answered.

### 7.3 Choice of AI provider — Gemini by default, swappable
The reference backend supports **Google Gemini** (default, since API credits for it are commonly available) and Anthropic's Claude, switched by one environment variable. Key integration details that must be gotten right (verified against current official documentation, not assumed from memory, since these details can and do change):

- Endpoint: `https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent`
- Auth: `x-goog-api-key` header (not a query-string key).
- Current default model as of this writing: `gemini-3.5-flash` (check `https://ai.google.dev/gemini-api/docs/models` for what's current before assuming this hasn't changed).
- **Request shape differs meaningfully from Anthropic's**: system instructions go in a separate top-level `systemInstruction: {parts:[{text}]}` field, not mixed into the messages array; conversation turns use `role: 'user'` / `role: 'model'` (**not** `'assistant'` — this is a real, easy-to-miss mapping bug).
- **Response shape**: `{candidates: [{content: {parts: [{text}]}}]}` — extract and flatten `parts[].text`, then re-wrap into the Anthropic-style shape described in §7.2 so nothing downstream needs to change.
- Before trusting any of the above in a fresh build, verify current values with a web search — Gemini's API surface and model lineup change over time.

### 7.4 Backend security posture for local/personal use
The reference backend's AI route is a deliberate, explained exception to its own real-auth pattern: because the front-end's login is a simple demo-PIN system (§2.3) with no way to hand the backend a real signed token, the AI proxy route is left **unauthenticated by default** — an acceptable trade-off *only* because the server binds to `127.0.0.1` (localhost) by default, not `0.0.0.0`. If it's ever exposed beyond localhost (a home network, a public host), an optional shared-secret header check must be turned on first, or anyone who finds the port can spend the account owner's API credits. Every other route (roster, finance, attendance-override, sync) keeps full JWT + role-based auth.

### 7.5 CORS — a specific, easy-to-hit failure mode
If this HTML file is opened directly as a `file://` document (very likely, given the whole point is zero-setup portability) while a local Node backend runs separately on `http://localhost:<port>`, that's a cross-origin request. Browsers send `Origin: null` (or omit Origin entirely) for `file://` pages making cross-origin requests. **A CORS configuration that only allowlists one hardcoded `http://localhost:5173`-style origin will silently block this and manifest as "AI unavailable," indistinguishable from the backend simply not running.** The CORS policy must explicitly allow: no-Origin/`null`-Origin requests, any `localhost`/`127.0.0.1` port, and whatever explicit origin is configured — while still rejecting arbitrary external origins. This exact bug occurred once already in this project's history and should not be reintroduced.

### 7.6 Diagnosability
Given how many distinct things can prevent an AI call from succeeding (backend not running, backend running but missing its key, CORS blocking the request, genuinely offline, inside vs. outside Claude.ai), **generic error messages waste everyone's time.** Two things fixed a real repeated back-and-forth in this project's history and should be built in from the start:
1. **A specific-reason variable** captured at the point of failure (connection-refused vs. bad HTTP status vs. empty response) and surfaced in every user-facing error message, not just logged to the console.
2. **A self-service "test backend connection" button** that pings the backend's health endpoint directly (no AI tokens spent) and reports plainly: unreachable at all / reachable but not configured / working. This should be the first thing anyone reaches for when AI features seem broken, instead of reproducing the failure and sending a screenshot.

---

## 8. Branding

- A shield/torch/circuit emblem logo, embedded as a single base64-encoded string (defined once as a JS constant, referenced everywhere it's needed — the header, splash screen, login screen, browser favicon, and PDF export headers — never duplicated inline multiple times, which needlessly bloats the file).
- A brand color pair sampled directly from the actual logo's pixels (a deep navy and a cyan), used as accent colors for chrome that should feel distinctly "branded" — exam-mode banners, PDF headers — layered on top of, not replacing, the existing functional color system (blue/emerald/amber/red for interactive/success/warning/danger states).

---

## 9. Internationalization (i18n)

Five languages: English, Hindi, Kannada, Tamil, Telugu.

**Two different mechanisms for two different kinds of content — don't conflate them:**

1. **Fixed UI chrome** (button labels, nav items, headings) — a hand-authored dictionary, keyed by a short identifier, with all 5 language strings inline. Instant, works offline, no AI call needed. This should cover *every* user-facing string in the cadet-facing kiosk flow specifically (dashboard, subject-home, all 4 modules) — partial coverage where some screens are translated and others aren't reads as broken, not as "in progress."
2. **Dynamic content** (chapter text, quiz questions, AI-generated notes, doubt-solver replies) — a dictionary can never anticipate this text, so it must be translated live via an AI call and **cached** per (content-item, language) so the same translation isn't paid for repeatedly. Batch related items into one AI call where possible (e.g., translate an entire quiz + flashcard set in one request instead of one request per question) — this is both faster and meaningfully cheaper.

**Explicitly out of scope / accepted limitations, state them rather than pretend otherwise**: translations (both the hand-authored dictionary and the AI-generated ones) have not been reviewed by a native speaker of Kannada, Tamil, or Telugu. Say so in-app, don't imply verified accuracy.

---

## 10. Explicit DO's

1. **Do** keep the entire app in one HTML file unless there's an explicit, stated reason to split it up.
2. **Do** make IndexedDB the primary, non-optional data store for everything — never depend on a platform-specific storage API as the only persistence layer.
3. **Do** enforce RBAC centrally, at the router level, fail-closed for anything not explicitly listed as allowed.
4. **Do** log every administrative mutation, login/logout, blocked access attempt, and exam-integrity event to an audit trail with actor, role, and timestamp.
5. **Do** give every destructive or replacing action (resetting progress, loading new subject content over old) a reversible escape hatch, and put the control to use it everywhere the affected data is displayed, not just in one canonical place.
6. **Do** write accurate, specific, actionable error messages — never a generic message that could mean five different things, and never a hardcoded assumption (like "offline") that can be wrong.
7. **Do** validate every code change by actually parsing/executing it (extract and syntax-check embedded scripts; where feasible, actually run the logic against test inputs, including boundary cases) rather than trusting that an edit "looks right."
8. **Do** state architectural and content-accuracy limitations plainly, in-app, where the people relying on this system will actually see them (an "Architecture & Security Notes" panel worked well for this) — tag each note clearly as demo/illustrative vs. actually enforced.
9. **Do** verify external API details (endpoints, auth headers, current model names) against current documentation before writing integration code — provider APIs change.
10. **Do** default to the most conservative/secure configuration (localhost-only binding, no embedded secrets) and require deliberate, documented opt-in to loosen it.
11. **Do** ask what's actually wanted before assuming a "better" engineering approach (a proper multi-file build, TypeScript, a database) is welcome — this project's constraints (zero-setup, single-file, works offline) are load-bearing product requirements, not just technical debt to be paid down.

## 11. Explicit DON'Ts

1. **Don't** put any real API key or credential in this HTML file's client-side code, ever, under any framing ("just for local testing," "I'll remove it later"). Route AI calls through a small backend that holds the key server-side instead.
2. **Don't** treat client-side role checks as real access control for anything that will ever touch a real network-connected backend with real data. They are a UI convenience only.
3. **Don't** present built-in or AI-generated subject content as verified/authoritative without it actually having been checked against a real source — flag it honestly instead.
4. **Don't** rely on "Secure Exam Mode" as unbeatable anti-cheat. It deters casual cheating on a shared device; it cannot stop someone with full control of their own hardware.
5. **Don't** build a feature around the File System Access API as the *only* way to load local content — it's Chromium-only and frequently blocked in embedded/sandboxed preview contexts. Always pair it with a server-fetch-based alternative.
6. **Don't** assume a `file://`-opened page and a `localhost`-served backend can talk to each other without an explicit, correct CORS configuration that accounts for the `null`/no-Origin case.
7. **Don't** apply a partial or low-quality batch content load (e.g., most PDFs in a folder failed to extract) silently — gate it, and fail loud with specifics rather than corrupting good existing content.
8. **Don't** duplicate large embedded assets (like a base64 logo) multiple times through the file — define once, reference everywhere.
9. **Don't** let a "theoretically more correct" fix ship over evidence that it made a real, observed failure worse. If a user reports a fix regressed something, believe the report and revert the assumption, don't patch over it with more theory.
10. **Don't** silently swallow errors in AI-calling or extraction code (`catch(e){ return null }` with nothing else) — always propagate enough information that the calling UI can tell the person what actually happened.
11. **Don't** forget that a "role" or "status" concept might exist in more than one place in the data model (e.g., a cadet's overall roster status vs. their attendance status for a specific class) — when someone asks "how do I change X's status," check whether there are multiple plausible referents before assuming which one they mean, and consider surfacing/linking both.

---

## 12. Setup & Running Instructions

### Running the app itself
No build step. Open the `.html` file directly in any modern browser, or serve it from any static web server (needed only if you want the `Subjects/<KEY>/manifest.json` auto-load path from §6.6 to work).

### Enabling AI features (optional but recommended)
```bash
npm init -y
npm install express cors helmet dotenv jsonwebtoken bcryptjs
cp .env.example .env
# edit .env: set GEMINI_API_KEY (get one free at https://aistudio.google.com/apikey)
node server-reference.js
```
Leave the HTML file's backend-URL constant pointing at `http://localhost:8787` (the default). If the server isn't running, AI features degrade gracefully with a clear explanatory message rather than breaking anything else — every non-AI feature (attendance, roster, finance, exam mode, offline sync) works with zero backend at all.

### Loading real subject content
Either use the in-app folder-picker button (Chrome/Edge, normal browser tab — not inside an embedded preview), or serve the HTML file over `http(s)` alongside a `Subjects/<KEY>/manifest.json` + PDF structure as described in §6.6.

---

## 13. Known Open Items / Suggested Next Steps

- Source **actual verified DGNCC handbook material** and load it via §6.6 to replace the unverified baseline content — this is the single highest-value content improvement available.
- Get the Hindi/Kannada/Tamil/Telugu translations (both the fixed dictionary and the AI-translation prompts/output) reviewed by native speakers before relying on them for real instruction.
- If this is ever deployed to a real network-connected environment (not a single offline kiosk), replace the demo login and client-only RBAC with the real JWT + server-enforced RBAC pattern already sketched in `server-reference.js`, and do a proper security review before it holds real cadet data.
- Consider whether the syllabus-completion percentage should be redesigned to reflect actual chapter-read status and/or quiz score, rather than a flat per-attempt increment — flagged as a real design decision, not implemented as of this document.
- Decide deliberately, rather than by default, whether this should ever become a multi-file/build-tooled project — the single-file constraint has been load-bearing so far and should only be abandoned on purpose.

---

## 14. Deliverable Files (as of the last working version)

- **`Project-Prometheus-NCC-ANO-System.html`** — the entire application.
- **`server-reference.js`** — optional Node/Express backend: real JWT auth, RBAC middleware, audit logging, and the AI proxy (Gemini by default, Anthropic as an alternative).
- **`.env.example`** — template for the backend's environment variables (API keys, JWT secret, host binding, optional shared-secret protection).
