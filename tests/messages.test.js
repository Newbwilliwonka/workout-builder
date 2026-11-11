// Pure message rules: trim, one id per unsent text, and one bubble per id.
const assert = require('assert');
const M = require('../messages.js');

assert.strictEqual(M.cleanBody('  hi  '), 'hi');
assert.strictEqual(M.cleanBody('   '), '');
assert.strictEqual(M.cleanBody(null), '');

const first = M.prepareAttempt(null, ' hello ', function () { return 'id-1'; });
assert.deepStrictEqual(first, { id: 'id-1', body: 'hello' });
const retry = M.prepareAttempt(first, 'hello', function () { return 'id-2'; });
assert.strictEqual(retry.id, 'id-1');
const changed = M.prepareAttempt(first, 'hello!', function () { return 'id-3'; });
assert.strictEqual(changed.id, 'id-3');
assert.strictEqual(M.prepareAttempt(first, '   ', function () { return 'id-4'; }), null);

const merged = M.mergeById(
  [{ id: '1', body: 'a' }, { id: '2', body: 'b' }],
  [{ id: '1', body: 'a2' }, { id: '3', body: 'c' }]
);
assert.deepStrictEqual(merged.map(function (m) { return m.id + ':' + m.body; }), ['1:a2', '2:b', '3:c']);
var windowed = M.applyServerList(
  [
    { id: 'b', body: 'b', at: '2024-02-01T00:00:00.000Z' },
    { id: 'a', body: 'a', at: '2024-01-01T00:00:00.000Z' }
  ],
  [
    { id: 'old', body: 'old', at: '2020-01-01T00:00:00.000Z' },
    { id: 'c', body: 'c', at: '2024-03-01T00:00:00.000Z' },
    { id: 'a', body: 'stale', at: '2024-01-01T00:00:00.000Z' }
  ]
);
assert.deepStrictEqual(windowed.map(function (m) { return m.id + ':' + m.body; }), ['a:a', 'b:b', 'c:c']);
var freshOnly = M.applyServerList([], [
  { id: '2', body: '2', at: '2024-02-01T00:00:00.000Z' },
  { id: '1', body: '1', at: '2024-01-01T00:00:00.000Z' }
]);
assert.deepStrictEqual(freshOnly.map(function (m) { return m.id; }), ['1', '2']);

assert.strictEqual(M.initials('fan@example.com'), 'FA');
assert.strictEqual(M.initials('kinisiathletics@gmail.com'), 'KI');

console.log('MESSAGES UNIT OK');
