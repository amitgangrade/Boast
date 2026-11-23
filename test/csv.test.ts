import { expect, test } from 'vitest'
import { membersFromCsv, parseCsv } from '../shared/csv'

test('parses quoted fields, semicolons and Windows line endings', () => {
  expect(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"']])
  expect(parseCsv('﻿Name;Email\nAnn;ann@x.y\n\n')).toEqual([['Name', 'Email'], ['Ann', 'ann@x.y']])
})

test('maps loose headers and validates each row', () => {
  const csv = [
    'First name,Surname,E-mail,Squash level,Sex,Date of birth,Mobile,Country,Plays',
    'Ann,Lee,ANN@x.y,"2,400",F,12/03/1984,0777,uk,L',
    'Bob,,bob@x.y,,m,,,,',
    'Cat,,not-an-email,,,,,,',
    'Dan,,ann@x.y,,,,,,',
    'Eve,,eve@x.y,lots,,,,,',
    'Fay,,fay@x.y,,,,,Narnia,',
  ].join('\n')
  const { rows, missing } = membersFromCsv(parseCsv(csv))
  expect(missing).toEqual([])
  expect(rows[0].member).toEqual({ name: 'Ann Lee', email: 'ann@x.y', rating: 2400, gender: 'female', birthYear: 1984, phone: '0777', city: null, country: 'United Kingdom', dominantHand: 'left' })
  expect(rows[1].member).toMatchObject({ name: 'Bob', rating: null, gender: 'male' })
  expect(rows.slice(2).map((r) => [r.line, r.error])).toEqual([
    [4, '“not-an-email” isn’t a valid email'],
    [5, 'Same email as an earlier row'],
    [6, 'Rating “lots” isn’t a positive number'],
    [7, '“Narnia” isn’t a country we recognise'],
  ])
})

test('reports missing required columns', () => {
  expect(membersFromCsv(parseCsv('Player,Phone\nAnn,1')).missing).toEqual(['email'])
})
