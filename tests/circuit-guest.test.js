// Guest circuit placements: the SQL only returns a day's time, the circuit
// name, and the trainer's name. No network.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261124200000_circuit_guest_calendar.sql'), 'utf8');
assert.ok(sql.includes('circuit_guest_placements(p_client uuid)'));
assert.ok(sql.indexOf('drop function if exists public.circuit_guest_placements(uuid)') < sql.indexOf('create or replace function public.circuit_guest_placements'));
assert.ok(sql.includes('set search_path = public, pg_temp'));
assert.ok(sql.includes('auth.uid() = p_client'));
assert.ok(sql.includes('c.owner_id = auth.uid()'));
assert.ok(/security definer/i.test(sql));
assert.ok(sql.includes('placement_id text'));
assert.ok(sql.includes('e.local_id'));
assert.ok(sql.includes('day date'));
assert.ok(sql.includes('starts_at text'));
assert.ok(sql.includes('ends_at text'));
assert.ok(sql.includes('circuit_name text'));
assert.ok(sql.includes('trainer_name text'));
assert.ok(sql.includes("person->>'source' = 'linked'"));
assert.ok(sql.includes('trainer_clients'));
assert.ok(sql.includes("item->>'source' = 'circuit'"));
assert.ok(sql.includes("position('@' in p.display_name)"));
assert.ok(!/select[\s\S]{0,80}email/i.test(sql));
assert.ok(sql.includes('grant execute on function public.circuit_guest_placements(uuid) to authenticated'));
assert.ok(sql.includes('revoke all on function public.circuit_guest_placements(uuid) from public, anon'));

const auth = fs.readFileSync(path.join(__dirname, '../auth.js'), 'utf8');
assert.ok(auth.includes("rpc('circuit_guest_placements'"));
assert.ok(auth.includes('if (!res || res.error) return [];'));

console.log('circuit guest ok');
