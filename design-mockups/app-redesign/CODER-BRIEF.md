# Coach Trainer App — app-wide redesign: coder brief

Repo: https://github.com/Newbwilliwonka/workout-builder (base: `main`, currently `5cc124a` "Run a live group circuit session (#116)").
Design reference branch (NEVER merge it, never base a PR on it): `design/app-redesign-mockup`, folder `design-mockups/app-redesign/`.
Product owner: William. He reviews every PR by screenshots. He hates redundancy (the same word or link twice on one screen).

---------------------------------------------------------------------------------------------------
## 0. Read first: the design files

Check out the design files without merging:
`git fetch origin design/app-redesign-mockup && git checkout origin/design/app-redesign-mockup -- design-mockups/app-redesign` into a scratch dir (or `git worktree add`), then DO NOT commit that folder to your PR branch.

- `pages/*.html` + `pages/shell.css`: one static HTML page per screen. THIS IS THE SOURCE OF TRUTH FOR STYLING. Port its CSS (colors, radii, spacing, font sizes, shadows, bar/link-row/card/tile/carousel styles) into `style.css` and reuse its markup structure in the real render functions. Do not reinterpret or "improve" it.
- `png/*.png`: 390x844 phone renders (2x) of each page. Use these for the side-by-side review.
- `compare/*-today-vs-mockup.png`: today's app next to the mock-up.
- `today/*.png`: renders of today's app (useful for the dashboard charts and player).
- `assets/`, `stills/`, `png-src/`: images the mock-ups load.
- `RULES.md`: the saved rules (copied in full in section 2 below).
- `CODER-BRIEF.md`: this file.

Approved references that override older ones:
- Landing: `pages/landing-v2.html` / `png/landing-v2.png` (and `png/landing-v2-top.png`). The old `landing` mock-up is NOT approved and is not in the branch.
- Tracking dashboard: `pages/tracking-dashboard-v2.html` / `png/tracking-dashboard-v2.png`. The older `tracking-dashboard` draft is NOT approved and is not in the branch.
- The separate Subscriptions page mock-up is REJECTED and is not in the branch (see 4.18).
- Where this brief and a mock-up disagree, THIS BRIEF WINS (the mock-ups were drawn before some decisions, e.g. button labels, black bar on signed-out pages, Received workouts View button).

---------------------------------------------------------------------------------------------------
## 1. Core rules (non-negotiable)

1. The redesign is VISUAL-ONLY. Nothing built over the previous weeks may be undone. Every feature, button set, wording, route, guard, permission and behavior stays exactly as it works today unless it is listed in section 4 of this brief. If you think something must change that is not listed, do not change it: write it in the PR body under "Questions for William".
2. Built pages must closely match the mock-ups. Port the mock-up CSS/HTML; don't reinterpret. Reviewers will compare at 390px phone width.
3. No A1/A2/B1 superset letter tags anywhere (builder, player, up next, history).
4. Privacy: never show one person's email to another person, except on the Admin page. Use display names; if a name is missing or is an email, show the role (e.g. "Client").
5. The app is invite-only. Don't add any open sign-up path.
6. No Edge Function deploys (don't touch or deploy `supabase/functions`).
7. Any SQL goes in a new file in `supabase/migrations/` (follow the existing header style: "Apply once in the Supabase SQL editor AFTER …"). List every migration file in the PR body. William's assistant applies it live; never run SQL against production yourself. The app must not break if the migration is not applied yet (show a friendly "not ready yet" message, like other features do).
8. Never commit secrets, keys, or `.env` files.
9. Keep all existing tests passing (`tests/*.test.js`, run with `node tests/<file> [url]`; UI tests need the repo served, e.g. `python3 -m http.server 8787`, plus puppeteer-core + Chrome). Only update a test when it encodes behavior this brief explicitly changes (e.g. "Not scheduled" → "Unscheduled", Open → Edit, sign-out routing) and say which tests you changed and why in the PR body. Add tests for new behavior.
10. Bugbot must be clean before merge (address or explain every Bugbot comment).
11. Every PR posts side-by-side screenshots in the PR body: mock-up PNG vs built page, both at 390px phone width, one pair per page touched (signed-in pages with realistic sample data; use the test sign-in / local fixtures the existing UI tests use).
12. One coder, sequential PRs (see section 5). Open PR A as a DRAFT and STOP for screenshot review before starting PR B.

---------------------------------------------------------------------------------------------------
## 2. Saved rules (full text of RULES.md)

### Coach Trainer App: UI rules for the redesign

Sources: William's decisions, plus behavior enforced in code and tests at main `f53fb05`
(app.js, player.js, preview.js, programs.js, profile.js, sharing.js, sends.js, hub.js, style.css, tests/).

#### 1. The redesign is visual-only (rule #1)
- Every existing behavior, feature, button set, wording and decision in the live app stays exactly as it is.
  Nothing built in the last weeks may be undone. Change styling and layout only.
- If a mock-up and the live app disagree on anything other than styling, the live app wins unless William
  has approved the change. Each approved change is listed in the gallery note for that page.
- Don't invent features. Optional ideas must be clearly marked as ideas and not built without approval.

#### 2. Navigation (approved)
- Black top bar on every signed-in page: back arrow (where the page has one), page title, and an initials circle on the right that opens Account.
- Second black row: text links Workouts · Programs · Tracking · Messages · Hub. The active link is white with a blue underline, and a blue dot on Messages means unread messages or requests.
- Group Circuits and Send workout are the 2 shortcut tiles on the trainer's Workouts page (trainer only).
- The player, the live circuit and the signed-out pages show only the back arrow and title (no link row).
- Sign out stays in the top bar on Account. Admin (admin only) is a row on the Account page, not its own button (approved); it opens the same Admin page.

#### 2b. Per-card controls stay visible (until William decides otherwise)
- Keep every per-card control visible exactly as today: ▲ ▼, Delete, Edit, Unlink, End connection, End conversation, Cancel (invites), Remove access.
- Don't tuck any of them into a ⋮ / "more" menu or behind a swipe.

#### 3. Privacy
- Never show another person's email. Use display names; if a name is missing or is an email, show the role (for example "Client") instead.
- Emails appear only on the Admin page.
- The app is invite-only.

#### 4. Workout cards (Workouts page)
- Buttons per role are exactly as in the live app; only the order changes (Open, View, Run; from the calendar View, Run).
- Today's live card: ▲ ▼, Open, Run, View, Delete for every role; no per-card Send. Copies locked from a trainer have no ▲ ▼ / Delete. A Free Client tapping Open gets the plan note (Upgrade / Not now). All of that stays; only Open, View, Run is the new order.
- Copies from a trainer keep the "From <trainer name>" tag and "You can run it" / "You can edit it".
- Received workouts keep today's buttons (Open + Run).

#### 5. Workout builder (New / Edit workout)
- New workout and Edit workout are the same screen.
- Supersets: purple (#7c3aed) box with a chain icon, "Superset · N exercises", ▲ ▼, Unlink all; chain icons between members; per-card Unlink. **No A1/A2/B1 letter tags anywhere** (builder, player, up next).
- Hint "Tick 2 or more exercises, then tap “Link superset”." Dock: + Exercise, Link superset (purple), ▶ Start (green).
- Only the final rest in a superset round works: non-final rest fields are disabled with the warning "Only the final rest period will function in each set of a superset".
- The workout name in the top bar is tappable to rename (Trainer / Enthusiast own workouts).

#### 6. Exercise editor
- New exercise and Edit exercise are identical; only the title differs.
- Fields in order: Enter manually / Exercise library, (library: search, Equipment used, Target muscle, results with stills), Exercise name, Mode (Reps, Intervals, Timer, Stopwatch), Sets (Attempts for Stopwatch, # of intervals for Intervals), Weight (lb / kg / Bodyweight + value), mode fields, Notes, image/demo, Save exercise / Cancel.
- A library pick always replaces Notes with the library description (or clears them). Choosing Enter manually clears Notes that belong to the library exercise.
- Uploaded images stay on this device only (wording kept).

#### 7. Player
- Media window, upper-left: a solid grey bubble with white text (reps target such as "8 Reps", "Work", "Interval", "Ready", "Get ready", laps for stopwatch). During rest the bubble text is green. A purple "Superset" chip sits next to it in supersets.
- Rest: the demo is hidden; the rest label, the rest countdown and the hint ("Tap to Skip") are green (#6ee7b7). The info frame shows the next exercise's name under a green veil that shrinks with the countdown.
- Everything else on the white demo (work countdown, hint text) is blue #2563eb.
- No large reps indicator. Reps sets show no clock.
- All clocks sit in one vertical spot (52% down the media window), for every mode.
- The exercise info frame (name + one meta line, no set counter) is pinned UNDER the media window for every mode except Stopwatch. Supersets show only one info frame.
- The current exercise name uses the same size as the up-next name (both are the info-frame name).
- Controls live INSIDE the media window (tap the window; hint under the clock), the same way for every mode except Stopwatch.
- Interval paused: Resume (play) and Skip (skip-forward) as symbols only, no words, under the clock. Timer stays as is: no Skip / Resume symbols; a tap ends the work.
- Stopwatch: the media window shows only the stopwatch time (hundredths); no demo and no info frame in it; the bubble shows total laps ("1 Lap" / "6 Laps") and stays the same; the Lap / Finish button sits below the window.
- Carousel: every tile is a still picture of the exercise (library still, else the uploaded image, else "No media available"), never the name. Small set count on each tile ("Set 1/3", "Interval 2/4", "Attempt 1/1"). Current tile ringed; logged tiles dimmed with a ✓; chain icon between superset members of the same round.
- Carousel position: across the TOP (approved). Tile content and rules don't change.
- "Up next" shows only on the next tile, and only during rest, or on the following exercise in a superset round, or on the next interval of the same exercise.
- Tracking inputs exactly as today: Reps / Hold (s) / Rounds / Work (s) / Interval (s) steppers when present, Weight (unit) stepper or "Bodyweight", laps and lap events with Pass / Fail. A superset rest stacks every round member's tracking.
- Below tracking: Workout list (name + Notes button), End workout.
- View opens the same player in preview mode ("Preview - not tracked"; nothing saved).
- Not in the app, so don't add: −15s / +15s rest buttons, a Set 1–4 strip, an "End" link in the top bar.

#### 8. Programs
- Phones: calendar first, then a horizontal rail of workout cards (name + exercise count, no buttons). Drag a card onto a day, or tap a day.
- Calendar: Week / Month switch, Add to Google Calendar, legend (Trainer present, Solo, Completed, Not scheduled).
- Tapping a day: that day's workouts plus "Add workout" (when you can edit).
- Tapping a scheduled workout: **View, then Run**, then (when you can edit) Save times and Remove workout; the Add workout control stays as it is. Free Clients get View + Run only.
- Trainers get the Client picker (All clients, My calendar, each client).

#### 9. Profile
- Order: name-required message at the top when there's no name; title; photo + Upload photo; Name; Verification; Bio with counter (/150); Show me in trainer search; Service; Service location (privacy note, near-me hint, Address or city + Search, map, OpenStreetMap credit, Public location, Save pin, Remove pin); then Save / Cancel.
- The pin note text is exact: "Your exact pin is private. It is only used so clients can find you in the Trainer Hub search. Only your city and state are shown publicly."
- Name-required text: "To protect your email account from spammers, please enter a name in your profile before proceeding." (no Cancel while it's required).

#### 10. Other pages
- Tracking: History / Dashboard tabs, Client picker; History By workout / By exercise with search.
- Group circuit history entry and the dashboard Circuits card (sessions count + total circuit time) are planned for PR 3; they aren't part of Strength and Capacity.
- Circuits: say "Move", never "Rest". Only the coach's phone runs a session.
- Messages: Requests above the threads; "End conversation" stays a visible button on temporary Hub conversations.
- Send workout: one workout, many clients; note "Each person gets their own copy. An Enthusiast can edit it. A Free Client can run it. Your workout stays as it is."

Notes that update RULES.md (this brief wins where they differ):
- §4 "Open, View, Run" is superseded: the workout card button **Open is renamed Edit**, order **Edit, View, Run** (4.1).
- §4 "Received workouts keep today's buttons (Open + Run)" is superseded: add **View** (4.10).
- §8 legend "Not scheduled" becomes **"Unscheduled"** (4.12).
- §2 "the signed-out pages show only the back arrow and title" is superseded: signed-out pages have **no black bar at all** (4.17). The landing keeps its own top nav (4.16).
- §10 Send workout "one workout, many clients" is extended to **many workouts, many clients** in PR C (4.9).

---------------------------------------------------------------------------------------------------
## 3. Navigation and structure (approved)

Where it lives today: `index.html` `<header class="bar">` (`#back`, `#title`, `#account-signout`, `#header-signin`), `style.css`, `app.js` (`syncHeaderSignOut`, `showHeaderSignIn`, `backBtn.onclick`, `route()`).

- Black top bar on every signed-in page: back arrow (where the page has one today), page title on the left, and an **initials circle on the right that opens Account** (`#/account`). Use the person's initials from their display name; fall back to a person icon if there's no name. Sign out stays in the top bar on the Account page only (as today).
- Second black row (link row) on every signed-in page except the player, the live circuit, and the signed-out pages: **Workouts · Programs · Tracking · Messages · Hub**. Active link white with a blue underline. A blue dot on Messages when there are unread messages or requests (reuse today's request/unread badge logic: `refreshRequestBadges` / `paintRequestBadges`).
  - Workouts → `#/`, Programs → `#/programs`, Tracking → `#/tracking`, Messages → `#/messages`, Hub → `#/hub`. Keep each role's current access rules (e.g. a role that today gets the plan note for a page still gets it).
- Account opens only from the initials circle. The Messages / Trainer Hub / Send workout / Workouts buttons on Account (`#account-nav` in `drawAccount`) and on the old Subscriptions page are dropped because the bar carries them (approved).
- **Group Circuits** and **Send workout** become shortcut tiles at the top of the Workouts page. Group Circuits: trainers only (as today). **Send workout: ONLY trainers** see it (never clients or Enthusiasts).
- **Admin** (admin only) becomes a row on the Account page instead of a button in `#account-nav`; it opens the same Admin page (`#/admin`), keeps its pending-count badge.
- Per-card controls stay visible exactly as today (▲ ▼, Delete, Edit, Unlink, End connection, End conversation, Cancel invite, Remove access). **No ⋮ / more menu, no swipe.**
- Player: the mock-up player is approved: carousel across the TOP as still-image tiles; every player rule in RULES.md §7 is kept.
- Owner override: do not add a "Workouts from your trainer" row on Account or on Workouts. Trainer-sent copies appear in the client's Workouts list with no "From <trainer>" tag. A blue dot on the Workouts nav marks unseen copies and clears once that list has been seen. `#/received` is not a visible page.

---------------------------------------------------------------------------------------------------
## 4. Per-page approved changes

Code map (where each page is rendered today):

| Page | Route | Code |
|---|---|---|
| Landing | bare URL (`#` empty, signed out) | `index.html` `#landing`; `app.js` `showLanding`, `landingPlansHtml`, `fillLandingPlans`, `bindLandingShots`; `style.css` `.landing-*` |
| Sign in / Create account | `#/signin`, `#/join` | `app.js` `renderSign('in'/'up')` |
| Forgot / Reset password | `#/forgot`, `#/reset` | `app.js` `renderForgot`, `renderReset` |
| Waiting for access | (any, when not approved) | `app.js` `renderAccessWait` |
| Subscriptions (to remove) | `#/subscriptions` | `app.js` `renderSubscriptions`, `drawSubscriptions`, `signedOutHome`, `showHeaderSignIn` |
| Workouts home | `#/` | `app.js` `renderList`, plan note `levelNoteHtml` / `renderLevelNote` |
| Workout editor | `#/w/<id>` | `app.js` `renderWorkout` |
| Exercise editor + library | `#/w/<id>/ex/<id or new>` | `app.js` `renderEditor`, `repsUI`; `library.js` |
| Player / View | `#/play/<id>`, `#/view/<id>` | `player.js`, `preview.js`, `clock.js`, `media.js` |
| Programs | `#/programs` | `programs.js`, `preview.js` (calendar, legend at `pv-legend`, day sheet, entry menu `openMenu`) |
| Tracking History / session | `#/tracking`, `#/history…` | `tracking.js`, `history.js`, `app.js` `renderTracking`/`renderHistory` |
| Tracking dashboard | `#/tracking/dashboard…` | `dashboard.js`, `app.js` `renderDashboard` |
| Account | `#/account` | `app.js` `renderSimpleAccount`, `drawAccount`, `redeemCard`, `trainerSection` |
| Profile sheet | (sheet over Account) | `profile.js`, `places.js`, `app.js` `openProfileSheet` |
| Client page | `#/client/<id>` (from Account roster "View") | `app.js` `openClient`, `attachClientTools`, `paintClientTools`; `sharing.js` `clientHtml`; `library.js` (client account workouts) |
| Messages | `#/messages…` | `messages.js` |
| Hub | `#/hub…` | `hub.js` |
| Send workout / Received | `#/send`, `#/received`, `#/received/<id>` | `sends.js` (`drawSend`, `drawList`, `drawOne`) |
| Circuits list / set up | `#/circuits`, `#/circuits/new`, `#/circuits/<id>` | `circuits.js`, `circuit-model.js`, `grid.js` |
| Live circuit | `#/circuits/<id>/run` | `session.js` |
| Admin | `#/admin` | `app.js` `renderAdmin` |

### 4.1 Workouts (trainer and client)
- Workout card button **Open is renamed Edit**. Order: **Edit, View, Run**, then the rest as today (▲ ▼ before, Delete after; locked trainer copies still have no ▲ ▼ / Delete). Today the code (`renderList`) renders Open, Run, View.
- Roles/cards without Edit drop the Edit button (View, Run only). Specifically: a trainer copy that is "You can run it" (locked), and a Free Client's card where today Open only shows the plan note. Keep the workout name tap behavior as today. (If dropping it removes the only path to the Free Client plan note / Upgrade, say so in the PR body.)
- Trainer: Group Circuits and Send workout shortcut tiles at the top (3). Client/Enthusiast: no Send workout tile; no Group Circuits tile.
- "+ New workout" stays as today. Workouts (client) mock-up approved as drawn, except the Open → Edit change above.

### 4.2 Workout editor
- Remove the per-row "Unlink" button on exercise rows (`data-a="unlink1"` in `app.js`). Keep the superset box's **Unlink all** (`data-a="unlink"`). Everything else as today and as mocked.

### 4.3 Exercise editor and Exercise library
- In the mock-up the Reps field sits next to Sets while the "Reps type: Number / Range" switch is far below it. Fix: the Number-or-range choice must sit directly above the Reps field (as a tight label/switch right on top of it), or inside the Reps field as its placeholder hint. Reps and its Number/Range choice must read as one unit. Same on New exercise and Edit exercise and when the library is open. All other fields, order, and wording as today.

### 4.4 Approved as mocked (styling only, no behavior change)
Workout view, Received workouts look, Player Reps / Rest / Interval / Timer / Stopwatch, Programs day, Tracking History and session detail, Account (trainer + client), Profile sheet (see 4.6), Messages list, Message thread, Hub feed, Hub post, Hub find, Circuits list, Circuit setup (plus 4.15 in PR D), Admin, Workouts (client).

### 4.5 Account
- Trainer: Messages / Trainer Hub / Send workout buttons gone (bar + tiles carry them). Admin is a row. Invites, roster (View, End connection), Cancel invite, etc. stay visible as today.
- Client: Messages / Trainer Hub / Workouts buttons gone. No "Workouts from your trainer" row. In PR B, the "My info" row (4.14).

### 4.6 Profile sheet
- The mock-up PNG is cut off after the pin note. Below the note the full Service location section stays exactly as today: near-me hint, Address or city + Search, map, OpenStreetMap credit, Public location, Save pin, Remove pin; then Save and Cancel.
- Order (saved rule): name-required message (when required), title, photo + Upload photo, Name, Verification, Bio + counter (/150), Show me in trainer search, Service, Service location (as above), Save / Cancel.
- The mock-up shows it full-screen with a Cancel link top right (Cancel also stays at the bottom). No Cancel while a name is required (as today).

### 4.7 Send workout (look)
- Appearance approved as mocked. (Multi-send is PR C, 4.9.)

### 4.8 Player — Interval paused
- In the paused interval, the play (Resume) symbol is centered horizontally in the media window; the skip-forward (Skip) symbol moves to the right of it. Symbols only, no words, inside the media window under the clock. Timer stays as today (no symbols).

### 4.9 NEW FEATURE (PR C): send multiple workouts at once
- On Send workout, a trainer can pick **one or many workouts** and **one or many linked clients** and send in one action. Each client gets their own copy of each workout (same copy rules and note as today: "Each person gets their own copy. An Enthusiast can edit it. A Free Client can run it. Your workout stays as it is."). Reuse the existing single-send path per (workout, client) pair or batch it; handle partial failures clearly (say which ones did not send). Keep today's de-duplication/selection-key behavior in `sends.js` per workout. No new Edge Function. If it needs SQL, put it in a migration.

### 4.10 Received workouts
- Owner override: trainer-sent workouts are cards on the client's Workouts page, not a separate received list. Buttons are Edit, View, Run when the person can edit, and View, Run when the copy is locked. View plays without tracking. Run tracks. There is no "From <trainer>" tag.

### 4.11 Programs (entry)
- Tapping a scheduled workout: **View, then Run**, then (when you can edit) Save times and Remove workout. Free Clients: View + Run only. Presence choice may be drawn as the mock-up's segmented switch (same choice).

### 4.12 Programs calendar
- Rename legend "Not scheduled" to **"Unscheduled"** (`preview.js` `pv-legend`), so the word sits right next to its check mark. Update `tests/programs-unscheduled.test.js` accordingly.

### 4.13 Tracking dashboard
- Keep TODAY's chart visuals exactly: Hit the plan ring/donut (with rating key), Workouts and streak stat numbers with goal bars, Total volume mountain/line chart, Strength and Capacity bars, Consistency month grid, Static holds. Same six cards, order, titles, wording. Only the container changes: each card becomes its own white rounded card on the grey page under the link bar (reference `png/tracking-dashboard-v2.png`). Edit / Share / Reset / Save controls unchanged.

### 4.14 Client page → client info page (PR B)
- Today `#/client/<id>` (trainer taps View on a client in Account) shows the plan line, Free Client / Not shared cards, the Enthusiast's own workouts (read only), a Tracking list, and the client account workout tools (`attachClientTools`: view/run/edit a Free Client's account workouts and sent copies).
- REMOVE the Tracking section and the client's workouts list from this page (these are reached from Tracking, Workouts and Programs). BEFORE removing the client account workout tools, confirm each thing a trainer can do there today (view / run / edit a Free Client's account workouts, see sent copies) is reachable elsewhere (Programs client picker, Tracking client picker). If any action would become unreachable, keep it or list it under "Questions for William" in the PR; do not silently drop a capability.
- The page becomes the **client info page**: Age, Sex, Height, Weight, Physical training experience. Editable by BOTH the linked trainer and the client. Anthropometrics come later (not now).
- Note at the top, exactly: "Everything on this page is private between you and your trainer."
- The client reaches and edits their own copy from a "My info" row on their Account page (opens the same page for themselves, e.g. `#/client/me` or `#/info`). Keep it minimal.
- Data: new migration, e.g. `supabase/migrations/2026112xxxxxxx_client_info.sql`, new table `public.client_info` (client_id uuid primary key references `public.profiles(id)` on delete cascade; age int, sex text, height text or numeric + unit, weight numeric + unit, experience text with length limits; updated_at, updated_by). RLS: select/insert/update only for the client themself (`client_id = auth.uid()`) or their CURRENTLY linked trainer (active row in `public.trainer_clients` with `ended_at is null`; the existing helpers `public.account_linked(trainer, owner)` and `private.tracking_trainer_of(client)` already express this). Approved accounts only (`private.is_approved`), anon has no access, nobody else (not other trainers, not Hub, not admin UI unless you ask). Add an `*-sql.test.js` like the others. Never show the client's email.
- Keep the plan line and the Free Client / Not shared wording only if still meaningful; otherwise ask.

### 4.15 Group circuits flow (PR D)
- Today: set up (`circuits.js`) has a "Start session" button (`#circuit-start`, `data-act="run"`) shown only once the circuit is saved; the live screen (`session.js`) places clients and its "Start" button is enabled only when every client is placed or benched (`ready()`).
- New: on the SET UP screen, the trainer drags clients into stations and that placement is saved with the circuit (in the circuit's `data` jsonb; probably no SQL needed, but if the `circuits_data_object` check or `circuits_guard` rejects the new shape, add a migration). Make placement clearly visible on set up (each station shows who is in it; unplaced clients in a tray).
- The set up button is renamed **"Run session"**. Tapping it auto-benches anyone not placed in a station and opens the live screen already populated.
- The live screen's button is **"Start session"** and is enabled immediately. The trainer can still drag people between stations and to/from Benched before or after starting (no-shows, late arrivals).
- Keep all other PR 116 behavior: Start/Run hidden until the circuit is saved, Save/Cancel spacing, clock font `.pl-ro`, End session spacing. "Move", never "Rest". Only the coach's phone runs a session.

### 4.16 Landing (bare URL, signed out)
- Build per `landing-v2`: each feature is one fully rounded white card with its heading and its image together inside (image rounded on all four corners, not clipped at the top); the live site's soft blue-gray page background restored (#c5d4e6, with the live plate behind the top) running behind the features AND the subscription tiers.
- Top nav: title "Coach Trainer App" left, only **"Sign up / Sign in"** right. Then the 7 feature headings + images, then the subscription tiers (display only, not actionable until payments), then the "Sign up / Sign in" link at the bottom. Wording unchanged (headings in `index.html`, tiers from `membership.js` via `landingPlansHtml`).

### 4.17 Signed-out pages: no black bar
- Sign in, Create account, Forgot password, Reset password, Waiting for access: REMOVE the black top bar entirely (no back arrow, no title bar, no header Sign in / Sign out link). The page's own heading and in-page links remain, so nothing appears twice. Waiting for access keeps its in-page **Sign out** button (and loses the header Sign out that `syncHeaderSignOut` shows today when `accessWaitOn`).
- The name-required profile gate keeps whatever it needs to function (it's signed in); don't show a duplicate title.

### 4.18 Remove the separate Subscriptions page; signed-out routing
Findings in today's code:
- `#/subscriptions` (`renderSubscriptions`/`drawSubscriptions`) is (a) where every signed-out visit lands except the bare URL (`signedOutHome()` returns `#/subscriptions`), with a header "Sign in" link; and (b) a SIGNED-IN gate: an approved account with no plan (`!WBMembership.hasDesignated(profile)`, e.g. an admin-approved account with membership `none`) is sent there by `openSignedIn`, `openAccount`, `renderSimpleAccount` and shown "Choose a level to continue." with Choose Enthusiast / Trainer / Master Trainer buttons that save `intended_plan` (`WBAuth.saveIntended`), plus the invite-code Redeem card and a Sign out link.
- Signed-in links into it: the plan note "Upgrade" button (`levelNoteHtml`, `#level-upgrade`, in `renderLevelNote` and on the Workouts list), the dashboard "Upgrade to Enthusiast" button (`#dashboard-upgrade`), and the library status "See plans" link (`libraryStatusHtml` / `paintLibraryStatus`). Account itself has no link to it.
What to do:
- Signed-out: every signed-out visitor, including right after signing out, lands on the LANDING page, never the sign-in page and never Subscriptions. Change `signedOutHome()` (invite arrivals still go to `#/join` as today), the sign-out handlers (`signOutFromAccount`, `#level-signout`, access-wait sign out) which today `go('#/signin')`, and any signed-out guard that sends to `#/signin` or `#/subscriptions` for a plain visit. Sign in from the landing goes to `#/signin`. Do NOT change: invite links → create account, password-recovery links → reset, a failed session check, and the flow after a successful sign-in. A signed-out visit to `#/subscriptions` redirects to the landing.
- Signed-in links (Upgrade, Upgrade to Enthusiast, See plans): point them to the landing's subscription tiers section (`#landing-plans`). Today the landing only renders when signed out on the bare URL, so add a minimal way to show it to a signed-in person scrolled to the tiers (e.g. a route like `#/plans` that shows the landing tiers with a back arrow). Do not make the tiers actionable.
- The signed-in "Choose a level to continue" gate must keep working (it's how an approved account without a plan picks Trainer / Master Trainer / Enthusiast before payments exist, and it carries the invite Redeem card). Do NOT delete that capability. Keep it as a gate page (no link row), styled with the landing tier cards, and list in the PR body exactly what you kept and why, under "Questions for William".
- Note in the PR body what you found linking to Subscriptions and what each now points to.

---------------------------------------------------------------------------------------------------
## 5. PR plan (ONE coder, sequential; never two coders at once)

- **PR A — Visual redesign** (draft first, then STOP for William's screenshot review): black bar + initials circle + link row; shortcut tiles; Admin row; Account button cleanup + the "Workouts from your trainer" row; every page's styling per the mock-ups (4.4, 4.6, 4.7, 4.13, 4.16); wording/button tweaks (4.1 Edit/View/Run, 4.2 remove per-row Unlink, 4.3 Reps/Number-or-range, 4.8 paused interval symbols, 4.10 Received View + header sentence, 4.11 View then Run, 4.12 Unscheduled); signed-out pages without the black bar (4.17); Subscriptions removal + signed-out routing to landing (4.18). No SQL.
- **PR B — Client info page** (4.14): migration + RLS + page for trainer and client + "My info" row.
- **PR C — Send multiple workouts** (4.9).
- **PR D — Circuit set up placement flow** (4.15).
- Order: A → (review) → B → C → D, each after the previous merges. Adjust the split only if the code clearly suggests a better one, but keep functional changes out of the visual PR (A). If 4.18 turns out larger than expected, it may become its own small PR right after A.
- Each PR body: summary, list of pages touched, side-by-side screenshots (mock-up vs built, 390px), migrations (if any), tests changed/added, "Questions for William".
