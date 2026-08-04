import { describe, expect, it } from 'vitest'
import { recoverPostalCode } from '../utils/postalCode.ts'

describe('recoverPostalCode', () => {
  it.each([
    ['nl', '8911', ['Ruiterskwartier 41', '8911 BP Leeuwarden'], '8911 BP'],
    ['be', '10', ['Rue du Midi 12', '1000 Bruxelles'], '1000'],
    ['de', '261', ['Wacholderweg 52a', '26133 Oldenburg'], '26133'],
    ['fr', '335', ['25 rue des Fleurs', '33500 Libourne'], '33500'],
    ['lu', null, ['71 route de Berlin', 'L-1234 Dudelange'], 'L-1234'],
    ['at', '12', ['Rennbahnweg 25', '1220 Wien'], '1220'],
    ['es', '450', ['Plaza de las Descalzas 27', '45012 Toledo'], '45012'],
    ['it', '001', ['Viale Europa 22', '00122 Roma'], '00122'],
    ['ie', 'T37', ['Macroom, Co. Cork', 'T37 F8HK'], 'T37 F8HK'],
    ['gb', 'EC1A', ['49 Featherstone Street', 'London EC1A 1HQ'], 'EC1A 1HQ'],
  ])('recovers a complete %s postal code', (country, structured, subtitles, expected) => {
    expect(recoverPostalCode(country, structured, subtitles)).toBe(expected)
  })

  it('keeps a complete structured value without guessing from other numbers', () => {
    expect(recoverPostalCode('be', '1000', ['Building 1234', '1000 Bruxelles'])).toBe('1000')
  })

  it('keeps the structured fallback when no agreeing candidate exists', () => {
    expect(recoverPostalCode('nl', '8911', ['1234 AB Other Town'])).toBe('8911')
  })
})
