import { render, act } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import MasonryLayout from '../components/shared/MasonryLayout.tsx'
import theme from '../theme.ts'

function wrap(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

// jsdom has no ResizeObserver; tests install this fake to drive re-measures.
let roCallbacks
class FakeResizeObserver {
  constructor(cb) {
    roCallbacks.push(cb)
  }

  observe() {}

  disconnect() {}
}

describe('MasonryLayout', () => {
  let offsetHeight

  beforeEach(() => {
    roCallbacks = []
    offsetHeight = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(100)
  })

  afterEach(() => {
    offsetHeight.mockRestore()
    delete globalThis.ResizeObserver
  })

  it('renders children in DOM order inside a grid container', () => {
    const { container } = wrap(
      <MasonryLayout columnWidth={280} spacing={2}>
        <div data-testid="a">A</div>
        <div data-testid="b">B</div>
        <div data-testid="c">C</div>
      </MasonryLayout>,
    )

    const grid = container.firstChild
    expect(getComputedStyle(grid).display).toBe('grid')
    const order = [...grid.querySelectorAll('[data-testid]')].map((el) => el.dataset.testid)
    expect(order).toEqual(['a', 'b', 'c'])
  })

  it('spans each item by its measured height plus the gap', () => {
    const { container } = wrap(
      <MasonryLayout columnWidth={280} spacing={2}>
        <div>A</div>
        <div>B</div>
      </MasonryLayout>,
    )

    // theme.spacing(2) = 16px → span = 100 (content) + 16 (gap) = 116 rows of 1px.
    const items = [...container.firstChild.children]
    expect(items).toHaveLength(2)
    items.forEach((item) => expect(item.style.gridRowEnd).toBe('span 116'))
  })

  it('re-measures when the item resizes', () => {
    globalThis.ResizeObserver = FakeResizeObserver
    const { container } = wrap(
      <MasonryLayout columnWidth={280} spacing={2}>
        <div>A</div>
      </MasonryLayout>,
    )

    const item = container.firstChild.children[0]
    expect(item.style.gridRowEnd).toBe('span 116')

    offsetHeight.mockReturnValue(250)
    act(() => roCallbacks.forEach((cb) => cb()))
    expect(item.style.gridRowEnd).toBe('span 266')
  })

  it('does not render grid items for null or boolean children', () => {
    const { container } = wrap(
      <MasonryLayout columnWidth={280} spacing={2}>
        {null}
        {false}
        <div data-testid="only">only</div>
      </MasonryLayout>,
    )

    expect(container.firstChild.children).toHaveLength(1)
  })
})
