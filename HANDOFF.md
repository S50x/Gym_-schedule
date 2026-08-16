# HANDOFF — Gym Schedule (حديد / saadtraininglog)

> Written for the next AI/engineer picking this up. Read this top to bottom before touching anything.

## 0. TL;DR

A single 1124-line Arabic localStorage HTML app was rewritten into a deployed,
tested, hardened Node app: accounts, Postgres, cross-device sync, optional 2FA,
strict CSP. **All code is done and green — 130 tests pass.** The only remaining
work is on the **user's side in the Render/Neon dashboards** (redeploy + set env
vars + run a persistence check). Do not rewrite what already works; help the user
finish deployment and answer questions.

- **Repo:** `S50x/Gym_-schedule` (GitHub). Session GitHub scope is this repo only.
- **Branch:** `claude/github-database-security-audit-8je5ft` (push here; never to `main` without permission).
- **PR:** #1, open, `mergeable_state: clean`, not merged. No CI configured on the repo.
- **User:** Arabic-speaking, non-technical (email shhv17@gmail.com). Reply in Arabic. Explain deploy steps concretely, one action at a time.

## 1. Current state (verified)

```
Branch:  claude/github-database-security-audit-8je5ft (local == origin == dabf25d)
Tests:   npm test → 130 pass / 0 fail (~16s, all on PGlite in-process)
Tree:    clean
```

Commit history (7 commits):
```
dabf25d Keep the interface out from under the Dynamic Island
c5450a9 Tell the user the truth when a request fails
51a369a Make TLS verification actually take effect on hosted Postgres
015f2d9 Harden the Postgres connection for scale-to-zero providers
106fcb3 Move the database to Postgres so data survives a restart
0d74069 Add two-factor authentication (TOTP + recovery codes)
8a7d6f5 Add cross-device sync, fix 25 bugs, harden the whole app
3021cb9 Initial commit
```

There is a **standing hourly self-check** on PR #1 (via `send_later`). It re-arms
silently while nothing changes, drives to green on any CI failure / review comment
/ merge conflict (this is our PR), and stops once the PR is merged or closed. If
you take over the watch, keep that behavior; don't spam the user on quiet ticks.

## 2. What the app is

Arabic gym + nutrition tracker, mobile-first, PWA (works offline, add-to-home-screen).
- **3-day lifting split** (Sat upper-push · Mon lower · Wed upper-pull) + 6 cardio days + Fri full rest.
- **Progression is conditional:** advances only if all sets completed AND perceived effort allows AND the weekly body-weight/muscle measurement doesn't show too large a deficit.
- **Nutrition page** back-calculates real maintenance calories from actual intake vs. weight change over two weeks.

## 3. Architecture

One SQL dialect everywhere (Postgres), two drivers behind one interface:
- **Production:** `pg` via `DATABASE_URL`.
- **Dev/tests:** `@electric-sql/pglite` (Postgres compiled to WASM, in-process). No DB server to install; tests are fast and isolated.

```
server/
  index.js          entry + graceful shutdown
  app.js            Express assembly: headers, static, routes, error handler
  config.js         env config + dependency-free .env reader
  db.js             Postgres layer (pg prod / PGlite dev) + migrations  ← most-revised file
  auth.js           scrypt password hashing + session management
  totp.js           TOTP RFC 6238 — no libraries
  mfa.js            login challenges + recovery codes
  qr.js             QR encoder — no libraries, verified in tests
  security.js       CSP, headers, CSRF, rate limiting
  state-schema.js   strict validation of synced doc + merge
  routes/           auth.js · state.js
public/
  index.html        structure only — zero inline script/style (strict CSP)
  css/app.css       styling  ·  css/fonts.css (generated)
  js/program.js     training program (single source, imported by browser AND server)
  js/engine.js      pure decision/progression/nutrition logic
  js/dom.js         safe element builder — replaces innerHTML; safeUrl() blocks non-http(s)
  js/store.js       local storage + sync
  js/gym.js         gym mode + rest timer
  js/views/         home · cardio · week · nutri · account
  sw.js             offline
  fonts/            self-hosted fonts (no third party)
test/               130 tests: auth · security · state · engine · totp · qr · mfa · postgres
docs/               BUGS.md (26) · SECURITY.md (21 findings + S21 2FA)
render.yaml         Render blueprint — creates service + DB and links them
scripts/            fetch-fonts.mjs
```

`program.js` and `engine.js` are pure (no DOM) so the server imports them directly —
no second drifting copy of the exercise list.

## 4. Security model (don't weaken these)

- **Passwords:** scrypt (N=65536), account-enumeration resistant.
- **Sessions:** tokens hashed with an HMAC server pepper before storage.
- **CSRF:** three independent layers — SameSite=Strict + Origin check + double-submit token.
- **CSP:** `default-src 'none'`, no `unsafe-inline`, no external origins. This is why all CSS/JS is extracted and all dynamic styling goes through the CSSOM, and why fonts are self-hosted.
- **2FA (TOTP RFC 6238):** enable-only-after-proof; password alone gives a short-lived single-use challenge, not a session; a code can't be reused within its 30s window (replay guard `totp_last_step`); disabling needs password AND code together; 10 one-time recovery codes stored hashed.
- **QR encoder** is hand-written (GF(256) Reed–Solomon, mask patterns, BCH format info); a dev-only test compares output unit-by-unit against a reference lib.

## 5. Deployment — what the USER still has to do

The last 3 commits (TLS fix, honest error messages, safe-area/Dynamic-Island fix)
are pushed but **not live** until Render redeploys. Walk the user through:

1. **Redeploy on Render** to pick up those 3 fixes.
2. **Rotate the Neon password** — it appeared once in a screenshot, so treat it as compromised. Reset it in Neon, then update `DATABASE_URL` in Render.
3. Render env vars:
   - `DATABASE_URL` = Neon connection string (Environment tab only — never a repo file, never chat)
   - `SESSION_SECRET` = use Render's **Generate** button (must never enter the transcript)
   - `ORIGIN` = exact domain, **no trailing slash** (a trailing `/` makes CSRF reject login)
   - `TRUST_PROXY=1`, `NODE_ENV=production`
   - `ALLOW_REGISTRATION=0` **only after** the account exists (else they lock themselves out)
4. **On the phone:** delete and re-add the home-screen icon to clear the stale service-worker cache.
5. **The persistence check (critical):** create account → log a workout → redeploy on Render → confirm both survive. This is the exact scenario that used to wipe data on SQLite. Do not declare deployment successful until this passes.

`DATABASE_URL` is the single integration point — any Postgres provider works
(Neon, Supabase, Render). `render.yaml` can provision service + DB together via
Render → New → Blueprint.

## 6. Hard security rules that stay in force

- **Never** ask for or accept the DB connection string or any secret in chat. A masked screenshot or first ~20 chars is enough; the password is never needed to help.
- Secrets belong only in Render's Environment tab, never in a repo file or the transcript.
- `SESSION_SECRET` from Render's Generate button, never generated in chat.

## 7. Where the interesting bugs were (context, in `docs/BUGS.md` / `docs/SECURITY.md`)

Five defects were invisible to unit tests and only caught by real-browser runs:
1. **Recovery codes lost forever** — `refreshUser()` re-rendered and detached the one-time codes node. Fix: made it silent; callers repaint.
2. **TLS verification silently disabled** — node-postgres merged the parsed connection string OVER the explicit `ssl` config; verification happened only by luck. The deeper lesson: the test had asserted what was *passed to* the lib, not what the client *actually used* (`client.connectionParameters.ssl`). Fixed with `stripTlsParams()`.
3. **UI under the Dynamic Island** — sync pill visible but untappable; `env(safe-area-inset-*)` is 0 in desktop browsers so no unit test saw it.
4. **Error message lied** — every network failure said "check your connection" when the real cause was the free host waking from sleep. Now `NetworkError` distinguishes `offline` vs `unreachable`.
5. **Service worker served stale cache** after each deploy.

Recurring theme worth keeping: **verify the value a system *decides*, not the value it was *told*.**

## 8. How to run locally

```bash
npm install
npm test          # 130 tests on PGlite, no DB server needed
npm start         # http://localhost:3000 ; with no DATABASE_URL it uses PGlite in ./data
npm run dev       # auto-restart
```

Browser journeys (real Chromium at /opt/pw-browsers): `smoke.mjs` (full app + two-browser sync + XSS checks) and `mfa.mjs` (full 2FA journey). Run these after any server-side change.

## 9. Next step for you

Nothing to build — code is complete and green. Concretely:
- Keep answering the user's deploy questions in Arabic, one step at a time.
- Keep the hourly PR #1 watcher running until the PR is merged or closed; drive to green on any real CI/comment/conflict since it's our PR; re-arm silently otherwise.
- If the user reports a real bug after deploy, reproduce in a real browser first (that's how the subtle ones surfaced), then fix on the `claude/github-database-security-audit-8je5ft` branch and push.
- If PR #1 is already merged when you arrive, treat any follow-up as a fresh change: restart the branch from latest `main`, don't stack on merged history.
