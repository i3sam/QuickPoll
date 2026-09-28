import { HttpError } from '../http.js';
import { keepUntil } from '../polls.js';

const pollKey = (slug) => `poll:${slug}`;
const countsKey = (slug) => `poll:${slug}:counts`;
const votersKey = (slug) => `poll:${slug}:voters`;

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

// Runs on Vercel with Upstash Redis. Every key expires by itself once a
// poll's results are no longer kept, so nothing needs cleaning up.
export class RedisStore {
  #redis;

  constructor({ redis }) {
    this.#redis = redis;
  }

  async init() {}

  async get(slug, voter = null) {
    const pipeline = this.#redis.pipeline();
    pipeline.get(pollKey(slug));
    pipeline.hgetall(countsKey(slug));
    pipeline.hlen(votersKey(slug));
    if (voter) pipeline.hget(votersKey(slug), voter);
    const [poll, counts, voters, myVote] = await pipeline.exec();
    if (!poll) return null;

    return {
      poll,
      counts: poll.options.map((_, index) => Number(counts?.[index] ?? 0)),
      voters: Number(voters) || 0,
      myVote: Array.isArray(myVote) ? myVote : null,
    };
  }

  async isTaken(slug) {
    return (await this.#redis.exists(pollKey(slug))) === 1;
  }

  async create(poll) {
    const result = await this.#redis.set(pollKey(poll.slug), poll, { nx: true, pxat: keepUntil(poll) });
    if (result !== 'OK') throw new HttpError(409, 'That link is already taken.');
  }

  async vote(poll, voter, choices) {
    const recorded = await this.#redis.eval(
      VOTE_SCRIPT,
      [countsKey(poll.slug), votersKey(poll.slug)],
      [voter, JSON.stringify(choices), String(keepUntil(poll)), ...choices.map(String)],
    );
    return Number(recorded) === 1;
  }

  // Closing early also brings forward when the poll is removed.
  async close(poll) {
    const until = keepUntil(poll);
    const pipeline = this.#redis.pipeline();
    pipeline.set(pollKey(poll.slug), poll, { xx: true, pxat: until });
    pipeline.pexpireat(countsKey(poll.slug), until);
    pipeline.pexpireat(votersKey(poll.slug), until);
    await pipeline.exec();
  }

  async delete(slug) {
    await this.#redis.del(pollKey(slug), countsKey(slug), votersKey(slug));
  }

  async sweep() {
    return 0;
  }

  limiter({ name, windowMs, max }) {
    return new RedisRateLimiter(this.#redis, { name, windowMs, max });
  }

  async flush() {}
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
