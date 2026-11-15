// Sample sets for history tests. Not loaded by the app.
const LB_TO_KG = 0.45359237;
const UPLOAD = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function at(y, m, d, hh, mm) { return new Date(y, m - 1, d, hh, mm).getTime(); }
function kg(lb) { return Math.round(lb * LB_TO_KG * 1000000) / 1000000; }
function lap(n, lapSec, totalSec) { return { n: n, lapSec: lapSec, totalSec: totalSec }; }

function sampleSets() {
  var farmer = 'c0ffee00-0000-4000-8000-000000000001';
  var sprint = 'c0ffee00-0000-4000-8000-000000000002';
  var plank = 'c0ffee00-0000-4000-8000-000000000003';
  function row(over) {
    return Object.assign({
      removed: false, status: 'completed', displayUnit: 'lb', workoutName: 'Workout',
      plannedBodyweight: false, actualBodyweight: false, actualLaps: [], actualEvents: []
    }, over);
  }
  return [
    row({ sessionId: 'sq-1112', localDate: '2026-11-12', startedAt: at(2026, 11, 12, 18, 40), workoutName: 'Lower strength', exerciseName: 'Barbell squat', libraryExerciseId: '0101', mode: 'reps', setNumber: 1, plannedReps: 5, plannedWeightKg: kg(205), actualReps: 3, actualWeightKg: kg(225) }),
    row({ sessionId: 'sq-1112', localDate: '2026-11-12', startedAt: at(2026, 11, 12, 18, 40), workoutName: 'Lower strength', exerciseName: 'Barbell squat', libraryExerciseId: '0101', mode: 'reps', setNumber: 2, plannedReps: 6, plannedWeightKg: kg(185), actualReps: 8, actualWeightKg: kg(185) }),
    row({ sessionId: 'sq-1112', localDate: '2026-11-12', startedAt: at(2026, 11, 12, 18, 40), workoutName: 'Lower strength', exerciseName: 'Barbell squat', libraryExerciseId: '0101', mode: 'reps', setNumber: 3, status: 'skipped', plannedReps: 5, plannedWeightKg: kg(225), actualReps: null, actualWeightKg: null }),
    row({ sessionId: 'sq-1112', localDate: '2026-11-12', startedAt: at(2026, 11, 12, 18, 40), workoutName: 'Lower strength', exerciseName: 'Barbell squat', libraryExerciseId: '0101', mode: 'reps', setNumber: 4, removed: true, plannedReps: 1, plannedWeightKg: kg(300), actualReps: 1, actualWeightKg: kg(300) }),
    row({ sessionId: 'sq-1108', localDate: '2026-11-08', startedAt: at(2026, 11, 8, 19, 5), workoutName: 'Lower strength', exerciseName: 'Barbell squat', libraryExerciseId: '0101', mode: 'reps', setNumber: 1, plannedReps: 6, plannedWeightKg: kg(185), actualReps: 6, actualWeightKg: kg(185) }),
    row({ sessionId: 'sq-1108', localDate: '2026-11-08', startedAt: at(2026, 11, 8, 19, 5), workoutName: 'Lower strength', exerciseName: 'Barbell squat', libraryExerciseId: '0101', mode: 'reps', setNumber: 2, plannedReps: 5, plannedWeightKg: kg(185), actualReps: 5, actualWeightKg: kg(205) }),
    row({ sessionId: 'sq-1101', localDate: '2026-11-01', startedAt: at(2026, 11, 1, 8, 15), workoutName: 'Lower strength', exerciseName: 'Barbell squat', libraryExerciseId: '0101', mode: 'reps', setNumber: 1, plannedReps: 5, plannedWeightKg: kg(185), actualReps: 5, actualWeightKg: kg(185) }),
    row({ sessionId: 'sq-1101', localDate: '2026-11-01', startedAt: at(2026, 11, 1, 8, 15), workoutName: 'Lower strength', exerciseName: 'Barbell squat', libraryExerciseId: '0101', mode: 'reps', setNumber: 2, plannedReps: 5, plannedWeightKg: kg(185), actualReps: 5, actualWeightKg: kg(175) }),
    row({ sessionId: 'sq-1022', localDate: '2026-10-22', startedAt: at(2026, 10, 22, 18, 10), workoutName: 'Lower strength', exerciseName: 'Barbell squat', libraryExerciseId: '0101', mode: 'reps', setNumber: 1, plannedReps: 8, plannedWeightKg: kg(135), actualReps: 8, actualWeightKg: kg(135) }),
    row({ sessionId: 'sq-1022', localDate: '2026-10-22', startedAt: at(2026, 10, 22, 18, 10), workoutName: 'Lower strength', exerciseName: 'Barbell squat', libraryExerciseId: '0101', mode: 'reps', setNumber: 2, plannedReps: 8, plannedWeightKg: kg(135), actualReps: 8, actualWeightKg: kg(135) }),
    row({
      sessionId: 'sp-1114', localDate: '2026-11-14', startedAt: at(2026, 11, 14, 17, 15), workoutName: 'Conditioning', exerciseName: 'Court sprint', personalExerciseId: sprint, stableKey: 'ex_sprint', mode: 'stopwatch', displayUnit: 'bodyweight', setNumber: 1, plannedBodyweight: true, actualBodyweight: true, plannedLapCount: 5, actualTotalSec: 72.4,
      actualLaps: [lap(1, 18.4, 18.4), lap(2, 17.55, 35.95), lap(3, 19.1, 55.05), lap(4, 17.35, 72.4)],
      actualEvents: [
        { lap: 1, name: 'First cone', result: 'pass' },
        { lap: 2, name: 'Turn', result: 'pass' },
        { lap: 3, name: 'Drop', result: 'fail' },
        { lap: 4, name: 'Finish', result: 'pass' }
      ]
    }),
    row({
      sessionId: 'sp-1107', localDate: '2026-11-07', startedAt: at(2026, 11, 7, 17, 20), workoutName: 'Conditioning', exerciseName: 'Court sprint', personalExerciseId: sprint, stableKey: 'ex_sprint', mode: 'stopwatch', displayUnit: 'bodyweight', setNumber: 1, plannedBodyweight: true, actualBodyweight: true, plannedLapCount: 4, actualTotalSec: 92.3,
      actualLaps: [lap(1, 22.1, 22.1), lap(2, 23.4, 45.5), lap(3, 24, 69.5), lap(4, 22.8, 92.3)],
      actualEvents: [
        { lap: 1, name: 'First cone', result: 'pass' },
        { lap: 2, name: 'Turn', result: 'fail' },
        { lap: 3, name: 'Drop', result: 'fail' },
        { lap: 4, name: 'Finish', result: 'pass' }
      ]
    }),
    row({
      sessionId: 'sp-1030', localDate: '2026-10-30', startedAt: at(2026, 10, 30, 17, 5), workoutName: 'Conditioning', exerciseName: 'Court sprint', personalExerciseId: sprint, stableKey: 'ex_sprint', mode: 'stopwatch', displayUnit: 'bodyweight', setNumber: 1, plannedBodyweight: true, actualBodyweight: true, plannedLapCount: 4, actualTotalSec: 100.2,
      actualLaps: [lap(1, 24.2, 24.2), lap(2, 25.1, 49.3), lap(3, 26.4, 75.7), lap(4, 24.5, 100.2)],
      actualEvents: [{ lap: 4, name: 'Finish', result: 'pass' }]
    }),
    row({ sessionId: 'fa-1111', localDate: '2026-11-11', startedAt: at(2026, 11, 11, 7, 30), workoutName: 'Strongman', exerciseName: 'Farmer carry', personalExerciseId: farmer, stableKey: 'ex_farmer', imageUrl: UPLOAD, mode: 'reps', setNumber: 1, plannedReps: 16, plannedWeightKg: kg(50), actualReps: 20, actualWeightKg: kg(50) }),
    row({ sessionId: 'fa-1104', localDate: '2026-11-04', startedAt: at(2026, 11, 4, 7, 30), workoutName: 'Strongman', exerciseName: 'Farmer carry', personalExerciseId: farmer, stableKey: 'ex_farmer', imageUrl: UPLOAD, mode: 'reps', setNumber: 1, plannedReps: 16, plannedWeightKg: kg(50), actualReps: 16, actualWeightKg: kg(50) }),
    row({ sessionId: 'fp-1110', localDate: '2026-11-10', startedAt: at(2026, 11, 10, 12, 10), workoutName: 'Upper pump', exerciseName: 'Face pull', libraryExerciseId: '0201', mode: 'timer', displayUnit: 'kg', setNumber: 1, plannedWorkSec: 40, plannedRestSec: 15, plannedReps: 12, plannedWeightKg: 15, actualWorkSec: 40, actualRestSec: 20, actualReps: 12, actualWeightKg: 15 }),
    row({ sessionId: 'fp-1103', localDate: '2026-11-03', startedAt: at(2026, 11, 3, 12, 10), workoutName: 'Upper pump', exerciseName: 'Face pull', libraryExerciseId: '0201', mode: 'timer', displayUnit: 'kg', setNumber: 1, plannedWorkSec: 40, plannedRestSec: 15, plannedReps: 12, plannedWeightKg: 15, actualWorkSec: 40, actualRestSec: 15, actualReps: 12, actualWeightKg: 15 }),
    row({ sessionId: 'bu-1109', localDate: '2026-11-09', startedAt: at(2026, 11, 9, 18, 0), workoutName: 'Lower strength', exerciseName: 'Bulgarian split squat', libraryExerciseId: '1001', mode: 'reps', displayUnit: 'bodyweight', setNumber: 1, plannedBodyweight: true, actualBodyweight: true, plannedReps: 10, actualReps: 12 }),
    row({ sessionId: 'bu-1103b', localDate: '2026-11-03', startedAt: at(2026, 11, 3, 18, 0), workoutName: 'Lower strength', exerciseName: 'Bulgarian split squat', libraryExerciseId: '1001', mode: 'reps', displayUnit: 'bodyweight', setNumber: 1, plannedBodyweight: true, actualBodyweight: true, plannedReps: 10, actualReps: 10 }),
    row({ sessionId: 'cr-1106', localDate: '2026-11-06', startedAt: at(2026, 11, 6, 6, 45), workoutName: 'Core', exerciseName: 'Crunch', libraryExerciseId: '0001', mode: 'intervals', displayUnit: 'bodyweight', setNumber: 1, plannedBodyweight: true, actualBodyweight: true, plannedWorkSec: 30, plannedRounds: 10, actualWorkSec: 30, actualRounds: 8 }),
    row({ sessionId: 'cr-1030', localDate: '2026-10-30', startedAt: at(2026, 10, 30, 6, 45), workoutName: 'Core', exerciseName: 'Crunch', libraryExerciseId: '0001', mode: 'intervals', displayUnit: 'bodyweight', setNumber: 1, plannedBodyweight: true, actualBodyweight: true, plannedWorkSec: 30, plannedRounds: 8, actualWorkSec: 30, actualRounds: 8 }),
    row({ sessionId: 'pl-1105', localDate: '2026-11-05', startedAt: at(2026, 11, 5, 6, 50), workoutName: 'Core', exerciseName: 'Plank', personalExerciseId: plank, stableKey: 'ex_plank', mode: 'static_hold', displayUnit: 'bodyweight', setNumber: 1, plannedBodyweight: true, actualBodyweight: true, plannedHoldSec: 60, actualHoldSec: 75 }),
    row({ sessionId: 'pl-1028', localDate: '2026-10-28', startedAt: at(2026, 10, 28, 6, 50), workoutName: 'Core', exerciseName: 'Plank', personalExerciseId: plank, stableKey: 'ex_plank', mode: 'static_hold', displayUnit: 'bodyweight', setNumber: 1, plannedBodyweight: true, actualBodyweight: true, plannedHoldSec: 60, actualHoldSec: 45 })
  ];
}

// The shape myHistory returns: own sessions and sets, removed rows already gone.
function remoteHistory(sets) {
  var sessions = {};
  var exercises = {};
  var rows = [];
  (sets || sampleSets()).forEach(function (s) {
    if (!sessions[s.sessionId]) {
      sessions[s.sessionId] = {
        id: s.sessionId,
        local_date: s.localDate,
        started_at: new Date(s.startedAt).toISOString(),
        workout_name: s.workoutName,
        status: 'completed'
      };
    }
    if (s.personalExerciseId && !exercises[s.personalExerciseId]) {
      exercises[s.personalExerciseId] = { id: s.personalExerciseId, stable_key: s.stableKey || '' };
    }
    if (s.removed) return;
    rows.push({
      session_id: s.sessionId,
      library_exercise_id: s.libraryExerciseId || null,
      personal_exercise_id: s.personalExerciseId || null,
      exercise_name: s.exerciseName,
      mode: s.mode,
      set_number: s.setNumber,
      status: s.status,
      removed: false,
      display_unit: s.displayUnit,
      planned_reps: s.plannedReps,
      planned_reps_min: s.plannedRepsMin,
      planned_reps_max: s.plannedRepsMax,
      planned_weight_kg: s.plannedWeightKg,
      planned_bodyweight: !!s.plannedBodyweight,
      actual_reps: s.actualReps,
      actual_weight_kg: s.actualWeightKg,
      actual_bodyweight: !!s.actualBodyweight,
      planned_hold_sec: s.plannedHoldSec,
      actual_hold_sec: s.actualHoldSec,
      planned_work_sec: s.plannedWorkSec,
      actual_work_sec: s.actualWorkSec,
      planned_rest_sec: s.plannedRestSec,
      actual_rest_sec: s.actualRestSec,
      planned_rounds: s.plannedRounds,
      actual_rounds: s.actualRounds,
      planned_total_sec: s.plannedTotalSec,
      actual_total_sec: s.actualTotalSec,
      planned_lap_count: s.plannedLapCount,
      actual_laps: s.actualLaps,
      actual_events: s.actualEvents
    });
  });
  return {
    sessions: Object.keys(sessions).map(function (id) { return sessions[id]; }),
    sets: rows,
    exercises: Object.keys(exercises).map(function (id) { return exercises[id]; })
  };
}

module.exports = { sampleSets: sampleSets, remoteHistory: remoteHistory, UPLOAD: UPLOAD };
