import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePollInput, parseVote, toPublicPoll } from '../server/polls.js';

const poll = { slug: 'maple', options: ['A', 'B', 'C'], multiple: false };

test('cleans up a poll and drops empty options', () => {
  const input = parsePollInput({ question: '  Lunch?  ', options: ['Tacos ', '', '  Sushi', '   '] });
  assert.deepEqual(input, {
    question: 'Lunch?',
    options: ['Tacos', 'Sushi'],
    multiple: false,
    duration: 7 * 24 * 60 * 60,
    slug: null,
  });
});

test('rejects polls that are missing pieces', () => {
  assert.throws(() => parsePollInput({ question: '', options: ['a', 'b'] }), /Add a question/);
  assert.throws(() => parsePollInput({ question: 'Q', options: ['a'] }), /at least two/);
  assert.throws(() => parsePollInput({ question: 'Q', options: ['Same', 'same'] }), /the same/);
  assert.throws(() => parsePollInput({ question: 'Q', options: Array.from({ length: 11 }, (_, i) => `${i}`) }), /up to 10/);
  assert.throws(() => parsePollInput({ question: 'Q', options: ['a', 'b'], duration: 5 }), /how long/);
  assert.throws(() => parsePollInput({ question: 'Q', options: ['a', 'b'], slug: 'API' }), /lowercase/);
  assert.throws(() => parsePollInput({ question: 'x'.repeat(201), options: ['a', 'b'] }), /under 200/);
});

test('accepts a custom link and multiple answers', () => {
  const input = parsePollInput({ question: 'Q', options: ['a', 'b'], slug: 'team-lunch', multiple: true, duration: 3600 });
  assert.equal(input.slug, 'team-lunch');
  assert.equal(input.multiple, true);
  assert.equal(input.duration, 3600);
});

test('checks votes against the poll', () => {
  const voter = 'abcdefghijklmnopqrstuvwx';
  assert.deepEqual(parseVote({ voter, choices: [1] }, poll), { voter, choices: [1] });
  assert.throws(() => parseVote({ voter, choices: [] }, poll), /Pick an option/);
  assert.throws(() => parseVote({ voter, choices: [3] }, poll), /does not exist/);
  assert.throws(() => parseVote({ voter, choices: [0, 1] }, poll), /one answer/);
  assert.throws(() => parseVote({ voter: 'short', choices: [0] }, poll), /voter id/);
  assert.deepEqual(parseVote({ voter, choices: [2, 0] }, { ...poll, multiple: true }).choices, [0, 2]);
  assert.throws(() => parseVote({ voter, choices: [1, 1] }, { ...poll, multiple: true }), /does not exist/);
});

test('public polls never include the admin key hash', () => {
  const stored = { ...poll, question: 'Q', createdAt: 1, closesAt: 2, closedAt: null, adminHash: 'secret' };
  const shown = toPublicPoll({ poll: stored, counts: [1, 0, 2], voters: 3 }, 0);
  assert.equal(JSON.stringify(shown).includes('secret'), false);
  assert.deepEqual(shown.options[2], { text: 'C', votes: 2 });
  assert.equal(shown.closed, false);
});
