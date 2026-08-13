import { describe, expect, it } from 'vitest'
import { stepBack, stepForward } from '../components/performance/navigation.ts'

// Every slide is one page unless a test says otherwise.
const singlePage = () => 1

describe('stepForward', () => {
  it('advances within a multi-page slide before moving on', () => {
    expect(stepForward({ slide: 0, page: 0 }, 3, 3)).toEqual({ slide: 0, page: 1 })
    expect(stepForward({ slide: 0, page: 1 }, 3, 3)).toEqual({ slide: 0, page: 2 })
  })

  it('moves to the next slide once the last page is shown', () => {
    expect(stepForward({ slide: 0, page: 2 }, 3, 3)).toEqual({ slide: 1, page: 0 })
  })

  it('wraps from the last slide back to the first', () => {
    expect(stepForward({ slide: 2, page: 0 }, 3, 1)).toEqual({ slide: 0, page: 0 })
  })
})

describe('stepBack', () => {
  it('steps back within a slide', () => {
    expect(stepBack({ slide: 1, page: 2 }, 3, singlePage)).toEqual({ slide: 1, page: 1 })
  })

  it('lands on the last page of the previous slide', () => {
    expect(stepBack({ slide: 1, page: 0 }, 3, () => 4)).toEqual({ slide: 0, page: 3 })
  })

  it('wraps from the first slide to the last', () => {
    expect(stepBack({ slide: 0, page: 0 }, 3, singlePage)).toEqual({ slide: 2, page: 0 })
  })
})
