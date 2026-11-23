/**
 * Per-isolate cache for data derived from the players and clubs tables (the
 * leaderboard's player list, the club directory). Triggers bump
 * data_versions.directory on every change to those tables (migration 0003), so a
 * request costs one row read when nothing changed instead of reading every player.
 * Cached values are shared between requests: callers must not mutate them.
 */
const entries = new Map<string, { version: number; value: unknown }>()

export async function cachedDirectory<T>(db: D1Database, key: string, load: () => Promise<T>): Promise<T> {
  const row = await db.prepare("SELECT version FROM data_versions WHERE name = 'directory'").first<{ version: number }>()
  const version = row?.version
  const hit = entries.get(key)
  if (version != null && hit && hit.version === version) return hit.value as T
  const value = await load()
  // Store under the version read *before* loading: a write in between bumps the
  // version, so the next request reloads rather than trusting this copy for long.
  if (version != null) entries.set(key, { version, value })
  return value
}
