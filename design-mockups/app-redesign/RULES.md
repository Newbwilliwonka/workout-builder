# Coach Trainer App: UI rules for the redesign

Sources: William's decisions, plus behavior enforced in code and tests at main `f53fb05`
(app.js, player.js, preview.js, programs.js, profile.js, sharing.js, sends.js, hub.js, style.css, tests/).

## 1. The redesign is visual-only (rule #1)
- Every existing behavior, feature, button set, wording and decision in the live app stays exactly as it is.
  Nothing built in the last weeks may be undone. Change styling and layout only.
- If a mock-up and the live app disagree on anything other than styling, the live app wins unless William
  has approved the change. Each approved change is listed in the gallery note for that page.
- Don't invent features. Optional ideas must be clearly marked as ideas and not built without approval.

## 2. Navigation (approved)
- Black top bar on every signed-in page: back arrow (where the page has one), page title, and an initials circle on the right that opens Account.
- Second black row: text links Workouts · Programs · Tracking · Messages · Hub. The active link is white with a blue underline, and a blue dot on Messages means unread messages or requests.
- Group Circuits and Send workout are the 2 shortcut tiles on the trainer's Workouts page (trainer only).
- The player, the live circuit and the signed-out pages show only the back arrow and title (no link row).
- Sign out stays in the top bar on Account. Admin (admin only) is a row on the Account page, not its own button (approved); it opens the same Admin page.

## 2b. Per-card controls stay visible (until William decides otherwise)
- Keep every per-card control visible exactly as today: ▲ ▼, Delete, Edit, Unlink, End connection, End conversation, Cancel (invites), Remove access.
- Don't tuck any of them into a ⋮ / "more" menu or behind a swipe.

## 3. Privacy
- Never show another person's email. Use display names; if a name is missing or is an email, show the role (for example "Client") instead.
- Emails appear only on the Admin page.
- The app is invite-only.

## 4. Workout cards (Workouts page)
- Buttons per role are exactly as in the live app; the workout card order is Edit, View, Run (from the calendar View, Run).
- Today's live card: ▲ ▼, Edit, View, Run, Delete for every role; no per-card Send. Copies locked from a trainer have no ▲ ▼ / Delete. A Free Client tapping the name still opens the plan note when they cannot edit. Copies keep "You can run it" / "You can edit it".
- Owner override: do not show a "From <trainer name>" tag, and do not show a separate "Workouts from your trainer" row. Trainer-sent workouts appear in the client's Workouts list. A blue dot on the Workouts nav marks unseen copies and clears once that list has been seen.

## 5. Workout builder (New / Edit workout)
- New workout and Edit workout are the same screen.
- Supersets: purple (#7c3aed) box with a chain icon, "Superset · N exercises", ▲ ▼, Unlink all; chain icons between members; per-card Unlink. **No A1/A2/B1 letter tags anywhere** (builder, player, up next).
- Hint "Tick 2 or more exercises, then tap “Link superset”." Dock: + Exercise, Link superset (purple), ▶ Start (green).
- Only the final rest in a superset round works: non-final rest fields are disabled with the warning "Only the final rest period will function in each set of a superset".
- The workout name in the top bar is tappable to rename (Trainer / Enthusiast own workouts).

## 6. Exercise editor
- New exercise and Edit exercise are identical; only the title differs.
- Fields in order: Enter manually / Exercise library, (library: search, Equipment used, Target muscle, results with stills), Exercise name, Mode (Reps, Intervals, Timer, Stopwatch), Sets (Attempts for Stopwatch, # of intervals for Intervals), Weight (lb / kg / Bodyweight + value), mode fields, Notes, image/demo, Save exercise / Cancel.
- A library pick always replaces Notes with the library description (or clears them). Choosing Enter manually clears Notes that belong to the library exercise.
- Uploaded images stay on this device only (wording kept).

## 7. Player
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

## 8. Programs
- Phones: calendar first, then a horizontal rail of workout cards (name + exercise count, no buttons). Drag a card onto a day, or tap a day.
- Calendar: Week / Month switch, Add to Google Calendar, legend (Trainer present, Solo, Completed, Not scheduled).
- Tapping a day: that day's workouts plus "Add workout" (when you can edit).
- Tapping a scheduled workout: **View, then Run**, then (when you can edit) Save times and Remove workout; the Add workout control stays as it is. Free Clients get View + Run only.
- Trainers get the Client picker (All clients, My calendar, each client).

## 9. Profile
- Order: name-required message at the top when there's no name; title; photo + Upload photo; Name; Verification; Bio with counter (/150); Show me in trainer search; Service; Service location (privacy note, near-me hint, Address or city + Search, map, OpenStreetMap credit, Public location, Save pin, Remove pin); then Save / Cancel.
- The pin note text is exact: "Your exact pin is private. It is only used so clients can find you in the Trainer Hub search. Only your city and state are shown publicly."
- Name-required text: "To protect your email account from spammers, please enter a name in your profile before proceeding." (no Cancel while it's required).

## 10. Other pages
- Tracking: History / Dashboard tabs, Client picker; History By workout / By exercise with search.
- Group circuit history entry and the dashboard Circuits card (sessions count + total circuit time) are planned for PR 3; they aren't part of Strength and Capacity.
- Circuits: say "Move", never "Rest". Only the coach's phone runs a session.
- Messages: Requests above the threads; "End conversation" stays a visible button on temporary Hub conversations.
- Send workout: one workout, many clients; note "Each person gets their own copy. An Enthusiast can edit it. A Free Client can run it. Your workout stays as it is."
