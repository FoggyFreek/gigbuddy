import './_envSetup.js'
// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  buildItemPatch,
  buildSetUpdateFields,
  parseNewItem,
  parseOrderedSetIds,
  parseReorderItemsPayload,
  toNonNegInt,
} from '../../../server/music/setlists/setlistValidators.js'

describe('setlist validators', () => {
  it('parses new song, pause, and break items without querying the database', () => {
    expect(parseNewItem({ item_type: 'song', song_id: '8', label: ' Opener ' })).toEqual({
      itemType: 'song', songId: 8, durationSeconds: null, label: 'Opener',
    })
    expect(parseNewItem({ item_type: 'pause', duration_seconds: '30', label: 'Break' })).toEqual({
      itemType: 'pause', songId: null, durationSeconds: 30, label: 'Break',
    })
    expect(parseNewItem({ item_type: 'break', duration_seconds: 0 })).toMatchObject({ itemType: 'break' })
    expect(parseNewItem({ item_type: 'song' })).toEqual({ error: 'song_id is required for song items' })
    expect(parseNewItem({ item_type: 'pause' })).toEqual({ error: 'duration_seconds is required for pause/break items' })
    expect(parseNewItem({ item_type: 'other' })).toEqual({ error: 'Invalid item_type' })
  })

  it('validates set fields and non-negative durations', () => {
    expect(buildSetUpdateFields({ name: '  Encore ', include_in_total: 0 })).toEqual({
      fields: ['name = $1', 'include_in_total = $2'], values: ['Encore', false],
    })
    expect(buildSetUpdateFields({ name: '  ' })).toEqual({ error: 'name cannot be empty' })
    expect(toNonNegInt(0)).toBe(0)
    expect(toNonNegInt(null)).toBe(0)
    for (const value of [-1, 1.5, 'nope']) expect(toNonNegInt(value)).toBeNull()
  })

  it('builds item patches that clear stale links and mutually exclusive sources', () => {
    expect(buildItemPatch({ linked_to_next: false, transition_note: 'ignored' }, 'song')).toEqual({
      sets: [{ col: 'linked_to_next', value: false }],
      rawSets: ['transition_note = NULL'],
      source: null,
    })
    expect(buildItemPatch({ chart_id: 7 }, 'song')).toEqual({
      sets: [{ col: 'chart_id', value: 7 }, { col: 'document_id', value: null }], rawSets: [],
      source: { chartId: 7, documentId: null },
    })
    expect(buildItemPatch({ document_id: null }, 'song')).toMatchObject({
      source: { chartId: null, documentId: null },
    })
    expect(buildItemPatch({ duration_seconds: 12 }, 'song')).toEqual({ error: 'Cannot set duration on a song item' })
    expect(buildItemPatch({ duration_seconds: -1 }, 'pause')).toEqual({ error: 'Invalid duration_seconds' })
    expect(buildItemPatch({ chart_id: 1, document_id: 2 }, 'song')).toEqual({
      error: 'An item can have only one performance source',
    })
    expect(buildItemPatch({ chart_id: 'bad' }, 'song')).toEqual({ error: 'Invalid performance source id' })
  })

  it('parses only complete, positive-id reorder payloads', () => {
    expect(parseOrderedSetIds({ orderedSetIds: ['1', 2] })).toEqual({ orderedSetIds: ['1', 2] })
    expect(parseOrderedSetIds({ orderedSetIds: [0] })).toEqual({ error: 'orderedSetIds must be an array of ids' })
    expect(parseReorderItemsPayload({ sets: [{ setId: '1', itemIds: ['2', 3] }] })).toEqual({
      payloadSets: [{ setId: 1, itemIds: [2, 3] }],
    })
    expect(parseReorderItemsPayload({ sets: [{ setId: 1, itemIds: [0] }] })).toEqual({ error: 'Invalid reorder payload' })
  })
})
