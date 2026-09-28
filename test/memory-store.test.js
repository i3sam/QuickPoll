import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { MemoryStore } from '../server/stores/memory.js';

const DAY = 24 * 60 * 60 * 1000;

function makePoll(slug, closesAt = Date.now() + DAY) {
  return { slug, question: 'Q', options: ['a', 'b'], multiple: false, createdAt: Date.now(), closesAt, closedAt: null, adminHash: 'x' };
}

test('saves polls and votes to disk and reads them back', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'quickpoll-'));
  try {
    const store = new MemoryStore({ dir });
    await store.init();
    await store.create(makePoll('otter'));
    await store.vote({ slug: 'otter' }, 'voter-1234567890abcdef', [1]);
    await store.flush();

    const reopened = new MemoryStore({ dir });
    await reopened.init();
    const entry = await reopened.get('otter', 'voter-1234567890abcdef');
    assert.deepEqual(entry.counts, [0, 1]);
    assert.deepEqual(entry.myVote, [1]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('removes polls a month after they close', async () => {
  const store = new MemoryStore();
  await store.create(makePoll('old', Date.now() - 31 * DAY));
  await store.create(makePoll('recent', Date.now() - DAY));

  assert.equal(await store.get('old'), null);
  assert.ok(await store.get('recent'));
  assert.equal(await store.sweep(), 1);
  assert.equal(await store.isTaken('old'), false);
});
