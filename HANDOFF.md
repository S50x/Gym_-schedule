# HANDOFF — Gym Schedule (حديد / saadtraininglog)

> For the next AI or engineer. Read this before touching anything.
>
> **Every number and status below was checked against `git` and GitHub when it was
> written. Check them again when you update this file** — the previous version of
> this document went stale on exactly these facts (it claimed 130 tests and an open
> PR #1 long after both had moved).

## 0. TL;DR

A single 1124-line Arabic localStorage HTML file became a deployed, tested,
hardened Node app: accounts, Postgres, cross-device sync, optional 2FA, strict
CSP, and five training goals that reshape the whole programme.

**The code is complete and green. The remaining work is on the user's side, in
the Render and Neon dashboards.** Do not rewrite what already works.

- **Repo:** `S50x/Gym_-schedule`. This session's GitHub scope is that repo only.
- **Branch:** `claude/github-database-security-audit-8je5ft` — push here, never to `main` without asking.
- **User:** Arabic-speaking, non-technical (shhv17@gmail.com). Reply in Arabic, one concrete step at a time.

## 1. Current state (verified)

```
main:    c4b9253   (PR #4 merged)
tests:   npm test     → 173 pass / 0 fail   (~15s, PGlite in-process)
browser: npm run browser → 7 journeys clean (~2m20s, boots its own server)
commits: 21
PRs:     #1 #2 #3 #4 — all merged, none open
```

No CI is configured on the repo, and there is no scheduled watcher running.

Shipped in order: cross-device sync + 25 bug fixes → 2FA → Postgres → TLS and
scale-to-zero hardening → honest network errors → safe-area fix → Volt redesign +
height → bilingual names, cardio splitting, plank timer → progress cards →
five goals + onboarding → live calorie target + goal review.

## 2. What the app is

Arabic gym and nutrition tracker. Mobile-first PWA: installs to the home screen,
works offline, syncs when the network returns.

- **The goal shapes everything** (§3b). Five of them; the fat-loss programme is
  3 lifting days + 6 cardio days, but that is one goal's shape, not the app's.
- **Progression is conditional:** a lift only goes up if every set was completed,
  perceived effort allows it, and the weekly weigh-in says the body can take it.
- **Nutrition** derives maintenance from today's weight, and can back-calculate a
  real figure from logged intake versus actual weight change.
- Volt theme (lime on graphite), bottom tab bar, bilingual exercise names,
  cardio split across up to 3 machines per day, and a countdown for timed holds.

## 3. Architecture

One SQL dialect everywhere (Postgres), two drivers behind one interface:
- **Production:** `pg` via `DATABASE_URL`.
- **Dev and tests:** `@electric-sql/pglite` — real Postgres compiled to WASM,
  in-process. Nothing to install; the SQL under test is the SQL that ships.

```
server/
  index.js          entry + graceful shutdown
  app.js            Express assembly: headers, static, routes, error handler
  config.js         env config + dependency-free .env reader
  db.js             Postgres layer (pg prod / PGlite dev) + migrations
  auth.js           scrypt password hashing + session management
  totp.js           TOTP RFC 6238 — no libraries
  mfa.js            login challenges + recovery codes
  qr.js             QR encoder — no libraries, verified against a reference in tests
  security.js       CSP, headers, CSRF, rate limiting
  state-schema.js   strict allow-list validation of the synced doc + merge
  routes/           auth.js · state.js
public/
  index.html        structure only — zero inline script or style (strict CSP)
  css/app.css       styling  ·  css/fonts.css (generated)
  js/program.js     EXERCISES catalogue + 5 GOALS; imported by browser AND server
  js/engine.js      pure decision / progression / nutrition logic, all goal-aware
  js/dom.js         safe element builder; safeUrl() blocks non-http(s)
  js/store.js       local-first storage + sync; owns goal, level, onboarding gate
  js/gym.js         gym mode, rest timer, timed-hold countdown
  js/views/         onboarding · home · cardio · week · nutri · account
  sw.js             offline caching (network-first; never caches /api)
  fonts/            self-hosted (no third-party request, no missing SRI)
test/               173 unit tests: auth · security · state · engine · totp · qr · mfa · postgres
test/browser/       7 Playwright journeys — see §8
docs/               BUGS.md (26) · SECURITY.md (21 findings + S21 2FA)
render.yaml         Render blueprint — provisions service + database together
```

`program.js` and `engine.js` are DOM-free so the server imports them directly.
There is no second copy of the exercise list to drift.

## 3b. Goals — the axis everything turns on

`program.js` has two layers: an `EXERCISES` catalogue (33 movements — names, cue,
weight step, starting load, and default sets/reps/rest) and five `GOALS`
(`cut` · `muscle` · `recomp` · `fitness` · `strength`) that pick from it, override
sets/reps/rest, and carry their own 7-day cardio week, nutrition direction and
weigh-in thresholds.

**The catalogue defaults ARE the fat-loss numbers**, so `cut` needs no overrides
and reproduces the original programme exactly.

Goal-aware functions take it as a trailing argument defaulting to `'cut'` — which
is why the pre-existing tests still pass untouched:

```
verdict(cur, prev, goal)      safeTarget(tdee, goal)     proteinTarget(kg, goal)
baseWeights(goal, level)      dailyTarget(nut, kg, goal) effectiveTdee(nut, kg)
goalReview({ profile, weight, goalKey })
```

**`verdict` is the one that matters.** The same 0.4 kg gain is a warning while
cutting and the target while building; a textbook cut is a red flag for a bulk.
Get it wrong and the app fights half its users every week.

**Nutrition is derived, never frozen.** `effectiveTdee` recomputes maintenance
from the latest recorded weight every time it is shown; only a *measured* figure
(`nutrition.measuredTdee`, backed out of real intake vs. weight change) overrides
the formula. `nutrition.tdee` and `nutrition.target` are legacy, optional, and no
longer written.

**`goalReview`** prompts on the home screen when the body has moved 7% since the
goal was set (`profile.startWeight`) or after 8 weeks (`profile.ts`). "Keep my
goal" re-anchors both, so staying is a decision rather than an oversight.

Stored as `doc.profile = { goal, level, startWeight, ts }`, merged by timestamp
like `nutrition`. **Rules that must not be broken:**

- **No profile + existing history ⇒ stay on `cut`/`int` silently.** Never drag
  someone mid-programme through onboarding. Only `!hasProfile && !hasHistory`
  triggers it, and only after `store.init()` has loaded (`loaded` in `main.js`).
- **Sets are bounded by `MAX_SETS`, not the exercise's own count.** That count now
  varies by goal; binding to it would invalidate a strength user's saved document
  the moment they switch to a three-set goal, and their sync would 400 forever.
- **Switching goal deletes nothing.** Weights are keyed by exercise id, so the old
  goal's numbers are still there if they switch back.
- **An existing account must be able to sign in on a new phone** without inventing
  a goal first — onboarding's "عندي حساب" escape (`goToLogin` in `main.js`).

## 4. Security model (don't weaken these)

- **Passwords:** scrypt (N=65536), account-enumeration resistant.
- **Sessions:** tokens stored only as HMAC-SHA256 with a server pepper.
- **CSRF:** three independent layers — SameSite=Strict, Origin check, double-submit token.
- **CSP:** `default-src 'none'`, no `unsafe-inline`, no external origins. This is
  why all CSS/JS is extracted, dynamic styling goes through the CSSOM, and fonts
  are self-hosted.
- **Sync input:** every document is rebuilt key by key against an allow-list
  derived from the program itself. Unknown keys never reach storage, which also
  closes prototype pollution.
- **2FA:** enable-only-after-proof; a correct password yields a short-lived
  single-use challenge, not a session; codes cannot be replayed inside their 30s
  window; disabling needs password AND code; 10 recovery codes stored hashed.

## 5. What the USER still has to do

1. **Redeploy on Render** to pick up whatever has merged since the last deploy.
2. **`ALLOW_REGISTRATION=0`** once their account exists, so nobody else can register.
3. **On the phone:** delete and re-add the home-screen icon after a deploy, to
   clear the old service-worker cache.
4. **The persistence check:** create account → log a workout → redeploy → confirm
   both survive. This is the exact scenario that lost data on SQLite.

Render env vars: `DATABASE_URL` (Neon), `SESSION_SECRET` (Render's Generate
button), `ORIGIN` (exact domain, **no trailing slash** — a trailing `/` makes CSRF
reject every login), `TRUST_PROXY=1`, `NODE_ENV=production`.

`DATABASE_URL` is the only integration point; any Postgres provider works.

## 6. Hard rules that stay in force

- **Never** ask for or accept a connection string, password or secret in chat. A
  masked screenshot or the first ~20 characters is enough; the password is never
  needed to help.
- Secrets live only in Render's Environment tab — never in a repo file, never in
  the transcript.
- `SESSION_SECRET` comes from Render's Generate button, never from chat.

## 7. Eight defects that unit tests could not catch

All eight passed a green suite and were found only by driving the real app. This
is why §8 exists.

1. **Recovery codes lost forever** — `refreshUser()` repainted and detached the
   one-time codes node. Fixed by making it silent; callers repaint.
2. **TLS verification silently disabled** — node-postgres merged the parsed
   connection string *over* the explicit `ssl` config. The deeper error was in the
   check: it asserted what was *passed to* the library rather than
   `client.connectionParameters.ssl`, the value the driver actually resolves.
3. **UI under the Dynamic Island** — visible but untappable. `env(safe-area-inset-*)`
   is 0 in every desktop browser, so no screenshot ever showed it.
4. **An error message that lied** — every network failure blamed the user's
   connection when the real cause was free hosting waking from sleep.
5. **Stale service-worker cache** served old JavaScript against a newer API.
6. **Onboarding swallowed existing users** — the gate ran on the first paint,
   before `store.init()` had read localStorage, when every document looks empty.
7. **Gym mode served the wrong goal's programme** — `gym.js` still imported the
   legacy plan, so a strength trainee opened their squat day and got dumbbells.
8. **The tab bar would not hide** — `#tabbar` outranks the browser's own
   `[hidden] { display: none }`.

Recurring theme: **verify what a system decides, not what it was told.**

## 8. How to run

```bash
npm install
npm test                  # 173 unit tests on PGlite — no database to install
npm start                 # http://localhost:3000 (PGlite in ./data if no DATABASE_URL)
npm run dev               # auto-restart

npm run browser           # all 7 browser journeys
npm run browser -- goals  # just the ones whose name matches
node test/browser/mfa.mjs # or run one directly
```

`npm run browser` **starts its own server** on a free port against a throwaway
database, so it works from a clean checkout with nothing set up. It needs a
Chromium binary: it looks under `PLAYWRIGHT_BROWSERS_PATH` (default
`/opt/pw-browsers`), or set `CHROME_PATH`. It exits non-zero when a journey fails.

| journey | covers |
|---|---|
| `goals` | the pre-goals regression (an old document must render unchanged) + all five goals differing in substance |
| `features` | bilingual names, tab-bar navigation, cardio split, plank countdown |
| `gymgoal` | gym mode serves the current goal's programme |
| `switch` | switching goal and back loses nothing |
| `review` | the calorie target follows the body; the goal review appears and dismisses |
| `smoke` | full app, sync between two browsers, stored-XSS probes |
| `mfa` | two-factor end to end, including recovery codes |

**Run these after any server-side or view change.** Every defect in §7 would have
been caught by one of them.

## 9. Known gaps

- **14 of the 33 exercises have no video link.** The new movements (barbell squat,
  bench, deadlift, overhead press, row, hip thrust, goblet squat, lunges, push-up,
  cable fly, side plank, bird dog, kettlebell swing, step-up) shipped without one
  because this environment's network policy blocks every exercise-video host, so
  no link could be verified. Guessed URLs were deliberately not shipped. The UI
  omits the button when `v` is absent, and a test enforces that any link present
  is https. **Adding verified links is a good first task** in an environment with
  network access.
- **Fat-loss protein moved from 1.6 to 2.0 g/kg** with the goals work, so an
  existing user's displayed protein target rose. Intentional, and flagged to the
  user, but worth knowing if they ask.
- **No password reset.** It needs an email service. If someone loses their phone
  *and* their recovery codes, the account is unreachable. Documented, not a bug.

## 10. Next step for you

Nothing is pending in the code. Concretely:

- Answer the user's questions in Arabic, one concrete step at a time.
- If they report a bug: **reproduce it in a real browser first** (§7), then fix on
  the branch above and push.
- If the branch's PR is already merged when you arrive, start fresh from `main`
  (`git checkout -B <branch> origin/main`); never stack on merged history.
- When you change behaviour, run `npm test` **and** `npm run browser`, and update
  §1 of this file with the real numbers.
