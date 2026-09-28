import fs from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from '../http.js';
import { keepUntil } from '../polls.js';
import { RateLimiter } from '../rate-limit.js';

// Keeps polls in memory and, when given a folder, saves them to a JSON file
// so they survive a restart. Right for one process; use Redis for more.
export class MemoryStore {
  #polls = new Map();
  #file;
  #saving = null;
  #dirty = false;

  constructor({ dir = null } = {}) {
    this.#file = dir ? path.join(dir, 'polls.json') : null;
  }

  async init() {
    if (!this.#file) return;
    await fs.mkdir(path.dirname(this.#file), { recursive: true });

    let saved;
    try {
      saved = JSON.parse(await fs.readFile(this.#file, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const { poll, counts, voters } of saved) {
      this.#polls.set(poll.slug, { poll, counts, voters: new Map(voters) });
    }
  }

  async get(slug, voter = null, now = Date.now()) {
    const entry = this.#live(slug, now);
    if (!entry) return null;

    return {
      poll: { ...entry.poll },
      counts: [...entry.counts],
      voters: entry.voters.size,
      myVote: (voter && entry.voters.get(voter)) ?? null,
    };
  }

  async isTaken(slug) {
    return this.#live(slug) !== null;
  }

  async create(poll) {
    if (this.#live(poll.slug)) throw new HttpError(409, 'That link is already taken.');
    this.#polls.set(poll.slug, { poll: { ...poll }, counts: poll.options.map(() => 0), voters: new Map() });
    this.#save();
  }

  // Returns false when this voter has already voted.
  async vote(poll, voter, choices) {
    const entry = this.#live(poll.slug);
    if (!entry || entry.voters.has(voter)) return false;

    entry.voters.set(voter, choices);
    for (const choice of choices) entry.counts[choice] += 1;
    this.#save();
    return true;
  }

  async close(poll) {
    const entry = this.#live(poll.slug);
    if (!entry) return;
    entry.poll.closedAt = poll.closedAt;
    this.#save();
  }

  async delete(slug) {
    this.#polls.delete(slug);
    this.#save();
  }

  async sweep(now = Date.now()) {
    let removed = 0;
    for (const [slug, entry] of this.#polls) {
      if (keepUntil(entry.poll) > now) continue;
      this.#polls.delete(slug);
      removed += 1;
    }
    if (removed > 0) this.#save();
    return removed;
  }

  limiter(options) {
    const limiter = new RateLimiter(options);
    return { take: async (key) => limiter.take(key) };
  }

  // Resolves once everything changed so far is on disk.
  async flush() {
    await this.#saving;
  }

  #live(slug, now = Date.now()) {
    const entry = this.#polls.get(slug);
    return entry && keepUntil(entry.poll) > now ? entry : null;
  }

  // Changes that arrive while a save is running are picked up by that same
  // save's next loop, so there is never more than one write at a time.
  #save() {
    if (!this.#file) return;
    this.#dirty = true;
    this.#saving ??= this.#writeLoop();
  }

  async #writeLoop() {
    try {
      while (this.#dirty) {
        this.#dirty = false;
        const data = [...this.#polls.values()].map(({ poll, counts, voters }) => ({
          poll,
          counts,
          voters: [...voters],
        }));
        const temp = `${this.#file}.tmp`;
        await fs.writeFile(temp, JSON.stringify(data));
        await fs.rename(temp, this.#file);
      }
    } catch (error) {
      console.error('Could not save polls:', error);
    } finally {
      this.#saving = null;
    }
  }
}
