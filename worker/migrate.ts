import init from '../migrations/0001_init.sql?raw'

/** Every file in migrations/, in order. Add new files here as well. */
const MIGRATIONS: Array<[name: string, sql: string]> = [['0001_init.sql', init]]

function statements(sql: string): string[] {
  return sql
    .replace(/--.*$/gm, '')
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean)
}

let ready: Promise<void> | null = null

/**
 * Applies pending migrations once per Worker instance, so a deploy never
 * needs a separate migration step. Uses the same bookkeeping table as
 * `wrangler d1 migrations apply`, so the two can be mixed.
 */
export function ensureSchema(db: D1Database): Promise<void> {
  ready ??= (async () => {
    await db
      .prepare(
        'CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)',
      )
      .run()
    const { results } = await db.prepare('SELECT name FROM d1_migrations').all<{ name: string }>()
    const done = new Set(results.map((r) => r.name))
    for (const [name, sql] of MIGRATIONS) {
      if (done.has(name)) continue
      await db.batch([
        ...statements(sql).map((s) => db.prepare(s)),
        db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').bind(name),
      ])
    }
  })().catch((e) => {
    ready = null
    throw e
  })
  return ready
}
