import { expect, test } from 'vitest'
import { cachedDirectory } from '../../worker/cache'
import { testDb } from './d1'

test('the directory cache reloads only after players or clubs change', async () => {
  const { d1, raw } = testDb()
  let loads = 0
  const load = () => cachedDirectory(d1, 'test', async () => ++loads)
  expect(await load()).toBe(1)
  expect(await load()).toBe(1)
  raw.prepare("INSERT INTO players (id, name) VALUES ('p1', 'Ann')").run()
  expect(await load()).toBe(2)
  raw.prepare("UPDATE players SET current_level = 1200 WHERE id = 'p1'").run()
  expect(await load()).toBe(3)
  raw.prepare("INSERT INTO clubs (slug, name) VALUES ('c', 'Club')").run()
  expect(await load()).toBe(4)
  raw.prepare("INSERT INTO groups (id, name, slug) VALUES ('g', 'G', 'g')").run()
  expect(await load()).toBe(4)
  raw.prepare("DELETE FROM players WHERE id = 'p1'").run()
  expect(await load()).toBe(5)
})
