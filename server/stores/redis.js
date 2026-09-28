import { HttpError } from '../http.js';
import { isClosed, keepUntil } from '../polls.js';

const pollKey = (slug) => `poll:${slug}`;
const countsKey = (slug) => `poll:${slug}:counts`;
const votersKey = (slug) => `poll:${slug}:voters`;
const reportsKey = (slug) => `poll:${slug}:reports`;

// Public polls, scored by creation time and by number of voters.
const FEED_NEW = 'community:new';
const FEED_TOP = 'community:top';

// Records a vote only if this voter hasn't voted yet, as one atomic step.
// KEYS: counts, voters. ARGV: voter, their choices as JSON, keep-until (ms),
// then one option index per choice.
const VOTE_SCRIPT = `
if redis.call('HSETNX', KEYS[2], ARGV[1], ARGV[2]) == 0 then return 0 end
for i = 4, #ARGV do redis.call('HINCRBY', KEYS[1], ARGV[i], 1) end
redis.call('PEXPIREAT', KEYS[1], ARGV[3])
redis.call('PEXPIREAT', KEYS[2], ARGV[3])
return 1
`;

// Runs on Vercel with Upstash Redis. Poll keys expire by themselves once a
// poll's results are no longer kept; the feeds drop stale entries as they're read.
export class RedisStore {
  #redis;

  constructor({ redis }) {
    this.#redis = redis;
  }

  async init() {}

  async get(slug, voter = null) {
    const pipeline = this.#redis.pipeline();
    queueRead(pipeline, slug, voter);
    return toEntry(await pipeline.exec());
  }

  async isTaken(slug) {
    return (await this.#redis.exists(pollKey(slug))) === 1;
  }

  async create(poll) {
    const result = await this.#redis.set(pollKey(poll.slug), poll, { nx: true, pxat: keepUntil(poll) });
    if (result !== 'OK') throw new HttpError(409, 'That link is already taken.');

    if (poll.public) {
      await Promise.all([
        this.#redis.zadd(FEED_NEW, { score: poll.createdAt, member: poll.slug }),
        this.#redis.zadd(FEED_TOP, { score: 0, member: poll.slug }),
      ]);
    }
  }

  async vote(poll, voter, choices) {
    const recorded =
      Number(
        await this.#redis.eval(
          VOTE_SCRIPT,
          [countsKey(poll.slug), votersKey(poll.slug)],
          [voter, JSON.stringify(choices), String(keepUntil(poll)), ...choices.map(String)],
        ),
      ) === 1;

    if (recorded && poll.public && !poll.hidden) await this.#redis.zincrby(FEED_TOP, 1, poll.slug);
    return recorded;
  }

  // Closing early also brings forward when the poll is removed.
  async close(poll) {
    const until = keepUntil(poll);
    const pipeline = this.#redis.pipeline();
    pipeline.set(pollKey(poll.slug), poll, { xx: true, pxat: until });
    pipeline.pexpireat(countsKey(poll.slug), until);
    pipeline.pexpireat(votersKey(poll.slug), until);
    pipeline.zrem(FEED_NEW, poll.slug);
    pipeline.zrem(FEED_TOP, poll.slug);
    await pipeline.exec();
  }

  async delete(slug) {
    await Promise.all([
      this.#redis.del(pollKey(slug), countsKey(slug), votersKey(slug), reportsKey(slug)),
      this.#removeFromFeeds([slug]),
    ]);
  }

  async listPublic({ sort, offset, limit, voter = null, now = Date.now() }) {
    const slugs = await this.#redis.zrange(sort === 'top' ? FEED_TOP : FEED_NEW, offset, offset + limit - 1, {
      rev: true,
    });
    if (slugs.length === 0) return { entries: [], next: null };

    const pipeline = this.#redis.pipeline();
    for (const slug of slugs) queueRead(pipeline, slug, voter);
    const replies = await pipeline.exec();

    const entries = [];
    const stale = [];
    slugs.forEach((slug, index) => {
      const entry = toEntry(replies.slice(index * 4, index * 4 + 4));
      if (entry && !entry.poll.hidden && !isClosed(entry.poll, now)) entries.push(entry);
      else stale.push(slug);
    });
    if (stale.length > 0) await this.#removeFromFeeds(stale);

    return { entries, next: slugs.length === limit ? offset + limit : null };
  }

  async report(poll, voter, threshold) {
    const key = reportsKey(poll.slug);
    const pipeline = this.#redis.pipeline();
    pipeline.sadd(key, voter);
    pipeline.scard(key);
    pipeline.pexpireat(key, keepUntil(poll));
    const [, count] = await pipeline.exec();

    if (Number(count) >= threshold && !poll.hidden) {
      poll.hidden = true;
      await Promise.all([
        this.#redis.set(pollKey(poll.slug), poll, { xx: true, pxat: keepUntil(poll) }),
        this.#removeFromFeeds([poll.slug]),
      ]);
    }
  }

  // True only for the first caller ever, so starter polls are added once.
  async claimSeed() {
    return (await this.#redis.set('community:seeded', 1, { nx: true })) === 'OK';
  }

  async sweep() {
    return 0;
  }

  limiter({ name, windowMs, max }) {
    return new RedisRateLimiter(this.#redis, { name, windowMs, max });
  }

  async flush() {}

  async #removeFromFeeds(slugs) {
    await Promise.all([this.#redis.zrem(FEED_NEW, ...slugs), this.#redis.zrem(FEED_TOP, ...slugs)]);
  }
}

// Four commands per poll, read back by toEntry.
function queueRead(pipeline, slug, voter) {
  pipeline.get(pollKey(slug));
  pipeline.hgetall(countsKey(slug));
  pipeline.hlen(votersKey(slug));
  pipeline.hget(votersKey(slug), voter ?? '-');
}

function toEntry([poll, counts, voters, myVote]) {
  if (!poll) return null;
  return {
    poll,
    counts: poll.options.map((_, index) => Number(counts?.[index] ?? 0)),
    voters: Number(voters) || 0,
    myVote: Array.isArray(myVote) ? myVote : null,
  };
}

class RedisRateLimiter {
  #redis;
  #name;
  #windowMs;
  #max;

  constructor(redis, { name, windowMs, max }) {
    this.#redis = redis;
    this.#name = name;
    this.#windowMs = windowMs;
    this.#max = max;
  }

  async take(key) {
    const counter = `limit:${this.#name}:${key}`;
    const count = await this.#redis.incr(counter);
    if (count === 1) await this.#redis.pexpire(counter, this.#windowMs);
    return count <= this.#max;
  }
}
