# Workout Builder (Stage 1 data model + Stage 2 builder UI)

Plain HTML/CSS/JS, no build step. Data lives in `localStorage` key `wb.data.v1`.

- `model.js` – pure data model/logic (works in browser as `window.WB` and in Node via `require`).
- `app.js` – mobile-first builder UI (hash routes `#/`, `#/w/<id>`, `#/w/<id>/ex/<id|new>`).
- Serve: `python3 -m http.server 8787` in this folder.
- Tests: `node tests/test.js [url]` (model tests; UI part needs `puppeteer-core` + Chrome).

## Data shape
```
{ version: 2, workouts: [Workout], sessions: [] }          // sessions reserved for the player (history, laps)
Workout  { id, name, items: [Exercise], createdAt, updatedAt }
Exercise { id, name, sets, weight: { unit: 'lb'|'kg'|'bodyweight', value: number|null },
           mode: 'reps'|'intervals'|'timer'|'stopwatch', modeConfig, notes,
           groupId: string|null,   // superset: 2+ contiguous exercises sharing a groupId
           media: null }           // future: { type: 'image'|'video', src, thumb }
modeConfig:
  reps      { repsType: 'number', count } | { repsType: 'range', min, max } | { repsType: 'static' }   // all reps types also have restSec (0 = none)
  intervals { workSec, repetitions }        // no rest by design
  timer     { workSec, restSec }
  stopwatch { lapsEnabled: true, lapCount }  // lapCount only when laps on; WB.formatStopwatch(ms) -> 'MM:SS.hh'
```
Migrations: `WB.migrate` upgrades v1 data on load (reps restSec=0, stopwatch lapCount=1).
Planned session record for the player: `{ id, workoutId, startedAt, endedAt, results: [{ exerciseId, set, laps: [ms...], totalMs }] }`.
`WB.buildPlayQueue(workout)` already returns the ordered steps, rotating supersets one set at a time (A1 B1 A2 B2 …).
