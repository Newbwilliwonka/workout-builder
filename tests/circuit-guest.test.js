// Guest circuit placements: invites live on the placement, and the SQL
// returns only a day's time, the circuit name, and the trainer's name.
// No network.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261124200000_circuit_guest_calendar.sql'), 'utf8');
assert.ok(sql.includes('circuit_guest_placements(p_client uuid)'));
assert.ok(sql.indexOf('drop function if exists public.circuit_guest_placements(uuid)') < sql.indexOf('create or replace function public.circuit_guest_placements'));
assert.ok(sql.includes('set search_path = public, pg_temp'));
assert.ok(/security definer/i.test(sql));
assert.ok(sql.includes('placement_id text'));
assert.ok(sql.includes('e.local_id'));
assert.ok(sql.includes('day date'));
assert.ok(sql.includes('starts_at text'));
assert.ok(sql.includes('ends_at text'));
assert.ok(sql.includes('circuit_name text'));
assert.ok(sql.includes('trainer_name text'));
assert.ok(sql.includes('circuit_placement_invites'));
assert.ok(sql.includes('enable row level security'));
assert.ok(sql.includes('client_id = (select auth.uid())'));
assert.ok(sql.includes('trainer_id = (select auth.uid())'));
assert.ok(sql.includes('circuit_placement_invites_save(p_placement text, p_clients uuid[])'));
assert.ok(sql.includes('on delete cascade'));
assert.ok(sql.includes('Invite only linked clients.'));
assert.ok(sql.includes('placed.local_id = placement_id'));
assert.ok(sql.includes('link.ended_at is null'));
assert.ok(sql.includes('auth.uid() = p_client'));
assert.ok(sql.includes('c.owner_id = auth.uid()'));
assert.ok(sql.includes('inv.client_id = p_client'));
assert.ok(sql.includes('trainer_clients'));
assert.ok(sql.includes("item->>'source' = 'circuit'"));
assert.ok(sql.includes("position('@' in p.display_name)"));
assert.ok(!sql.includes("c.data->'clients'"));
assert.ok(!/select[\s\S]{0,80}email/i.test(sql));
assert.ok(sql.includes('grant execute on function public.circuit_guest_placements(uuid) to authenticated'));
assert.ok(sql.includes('revoke all on function public.circuit_guest_placements(uuid) from public, anon'));

const dropped = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261124220000_circuit_without_saved_clients.sql'), 'utf8');
assert.ok(dropped.includes('drop column if exists clients'));
assert.ok(dropped.includes('drop table if exists public.circuit_clients'));
assert.ok(dropped.includes("new.data := new.data - 'clients'"));
assert.ok(dropped.includes('Name every station before saving.'));
assert.ok(!dropped.includes("array['clients', 'clock', 'order', 'stations']"));

const auth = fs.readFileSync(path.join(__dirname, '../auth.js'), 'utf8');
assert.ok(auth.includes("rpc('circuit_guest_placements'"));
assert.ok(auth.includes('if (!res || res.error) return [];'));
assert.ok(auth.includes("rpc('circuit_placement_invites_save'"));
assert.ok(auth.includes('Could not save who is invited.'));
assert.ok(!auth.includes("from('circuit_placement_invites')"));

console.log('circuit guest ok');
