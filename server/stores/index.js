import { Redis } from '@upstash/redis';
import { MemoryStore } from './memory.js';
import { RedisStore } from './redis.js';

// Uses Upstash Redis when it's connected, a local JSON file otherwise.
export async function createStore(config, env = process.env) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;

  if (url && token) {
    return new RedisStore({ redis: new Redis({ url, token }) });
  }

  if (env.VERCEL) {
    throw new Error("Storage isn't set up yet. Connect an Upstash Redis database to this project in Vercel, then redeploy.");
  }

  const store = new MemoryStore({ dir: config.dataDir });
  await store.init();
  return store;
}
