// Place parsing for the service pin. No network and no database.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const P = require('../places.js');

assert.ok(P.MIN_GAP >= 1000);
assert.ok(P.REVERSE_WAIT >= 1000);
assert.strictEqual(P.PRIVACY_NOTE, 'Your exact pin is private. It is only used to find nearby clients in the Trainer Hub search. Only your city and state are shown publicly.');
assert.ok(P.NEAR_NOTE.indexOf('not saved') !== -1);
assert.ok(P.NOMINATIM.indexOf('nominatim.openstreetmap.org') !== -1);
assert.ok(P.TILES.indexOf('tile.openstreetmap.org') !== -1);

const austin = P.placeFromAddress({ city: 'Austin', state: 'Texas', country: 'United States' });
assert.strictEqual(austin.city, 'Austin');
assert.strictEqual(austin.region, 'Texas');
assert.strictEqual(austin.country, 'United States');
assert.strictEqual(austin.ok, true);

const town = P.placeFromAddress({ town: ' Bend ', state: 'Oregon', country: 'United States' });
assert.strictEqual(town.city, 'Bend');
assert.strictEqual(town.ok, true);

const missing = P.placeFromAddress({ city: 'Austin', country: 'United States' });
assert.strictEqual(missing.ok, false);
assert.strictEqual(P.publicLabel('Austin', 'Texas'), 'Austin, Texas');
assert.strictEqual(P.publicLabel('  ', 'Texas'), 'Texas');
assert.strictEqual(P.publicLabel('<script>', 'Texas'), '<script>, Texas');

const src = fs.readFileSync(path.join(__dirname, '..', 'places.js'), 'utf8');
assert.ok(src.indexOf("addEventListener('input'") === -1);
assert.ok(src.indexOf('oninput') === -1);
assert.ok(src.indexOf('scheduleReverse') !== -1);
assert.ok(src.indexOf('OpenStreetMap') !== -1);

const profile = fs.readFileSync(path.join(__dirname, '..', 'profile.js'), 'utf8');
assert.ok(profile.indexOf('id="pin-city"') === -1);
assert.ok(profile.indexOf('id="pin-state"') === -1);

console.log('places ok');
