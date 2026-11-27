// Master Trainer circuit guard. Text only. Does not touch a database.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const name = '20261127140000_master_trainer_circuits.sql';
const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations', name), 'utf8');

[
  'private.can_build_circuits()',
  "membership = 'master_trainer'",
  'private.is_admin()',
  'Group circuits are part of Master Trainer.',
  'circuits_tier_guard',
  'before insert or update on public.circuits',
  'circuit_save_run_trainer',
  'grant execute on function public.circuit_save_run(jsonb) to authenticated'
].forEach(function (bit) {
  assert.ok(sql.indexOf(bit) !== -1, bit);
});
assert.ok(sql.indexOf("membership in ('trainer', 'master_trainer')") === -1);
console.log('circuits tier sql ok');
