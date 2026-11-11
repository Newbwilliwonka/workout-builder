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
assert.strictEqual(M.initials('fan@example.com'), 'FA');
assert.strictEqual(M.initials('kinisiathletics@gmail.com'), 'KI');

console.log('MESSAGES UNIT OK');
