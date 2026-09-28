// Shared by the browser and the server, so both agree on what a valid link is.

export const SLUG_MIN = 3;
export const SLUG_MAX = 40;

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

const RESERVED = new Set([
  'about', 'admin', 'api', 'assets', 'community', 'explore', 'help', 'login', 'new', 'poll', 'polls', 'privacy',
  'settings', 'signup', 'terms',
]);

export function isValidSlug(value) {
  return (
    typeof value === 'string' &&
    value.length >= SLUG_MIN &&
    value.length <= SLUG_MAX &&
    SLUG_PATTERN.test(value) &&
    !value.includes('--') &&
    !RESERVED.has(value)
  );
}

// "Team Lunch!" -> "team-lunch"
export function normalizeSlug(value) {
  return value
    .toLowerCase()
    .replace(/[\s_.]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, SLUG_MAX);
}
