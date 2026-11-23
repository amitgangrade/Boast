import { DatabaseSync } from 'node:sqlite'
import { MIGRATIONS, statements } from '../../worker/migrate'

type Value = string | number | null

/** Just enough of D1's API over node:sqlite to run Worker queries in tests. */
class Stmt {
  constructor(
    private db: DatabaseSync,
    readonly sql: string,
    readonly args: Value[] = [],
  ) {}
  bind(...args: unknown[]) {
    return new Stmt(this.db, this.sql, args.map((a) => (typeof a === 'boolean' ? +a : (a as Value) ?? null)))
  }
  async all<T>() {
    return this.allSync<T>()
  }
  allSync<T>() {
    const s = this.db.prepare(this.sql)
    if (s.columns().length === 0) {
      const r = s.run(...this.args)
      return { results: [] as T[], success: true, meta: { changes: Number(r.changes) } }
    }
    return { results: s.all(...this.args) as T[], success: true, meta: { changes: 0 } }
  }
  async first<T>() {
    return (this.allSync<T>().results[0] ?? null) as T | null
  }
  async run() {
    return this.allSync()
  }
}

export function testDb() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  for (const [, sql] of MIGRATIONS) for (const s of statements(sql)) db.exec(s)
  const d1 = {
    prepare: (sql: string) => new Stmt(db, sql),
    async batch(stmts: Stmt[]) {
      db.exec('BEGIN')
      try {
        const out = stmts.map((s) => s.allSync())
        db.exec('COMMIT')
        return out
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    },
    exec: (sql: string) => db.exec(sql),
  }
  return { d1: d1 as unknown as D1Database, raw: db }
}
