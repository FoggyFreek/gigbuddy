import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// The chart slide measures itself; jsdom has neither ResizeObserver nor layout.
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

// jsdom can't run the pdf.js worker; stub react-pdf with inspectable elements.
vi.mock('react-pdf', () => {
  function Document({ file, children, onLoadSuccess }) {
    return (
      <div data-testid="pdf-document" data-file={file}>
        <button type="button" data-testid="pdf-load" onClick={() => onLoadSuccess({ numPages: 3 })}>
          load
        </button>
        {children}
      </div>
    )
  }
  function Page({ pageNumber }) {
    return <div data-testid="pdf-page" data-page={pageNumber} />
  }
  return { Document, Page, pdfjs: { GlobalWorkerOptions: {} } }
})

vi.mock('../setlists.ts', () => ({ getSetlistPerformance: vi.fn() }))

import PerformancePage from '../PerformancePage.tsx'
import { getSetlistPerformance } from '../setlists.ts'
import theme from '../../../theme.ts'

const slide = (overrides) => ({
  item_id: 1, item_type: 'song', source_kind: 'none', set_id: 10, set_name: 'Set 1',
  title: null, label: null, artist: null, transition_note: null, my_note: null,
  chart_id: null, chart_source: null, document_id: null, document_object_key: null,
  ...overrides,
})

const CHART = slide({
  item_id: 1, source_kind: 'chart', title: 'Opener', chart_id: 7,
  // One word per lyric line: ChordSheetJS lays lyrics out in per-word columns,
  // so a multi-word line would not be a single text node to assert on.
  chart_source: '{title: Opener}\n[C]Hallelujah',
  transition_note: 'straight into the next one',
})
const BARE = slide({ item_id: 2, title: 'Bare Song' })
const PDF = slide({
  item_id: 3, source_kind: 'document', title: 'Closer', document_id: 9,
  document_object_key: 'tenants/1/song_documents/closer.pdf',
})

function wrap(perf, search = '') {
  getSetlistPerformance.mockResolvedValue(perf)
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={[`/setlists/5/perform${search}`]}>
        <Routes>
          <Route path="/setlists/:id/perform" element={<PerformancePage />} />
          <Route path="/setlists/:id" element={<div>editor</div>} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  )
}

const show = (slides) => ({ id: 5, name: 'Show', slides })

// Navigates between two setlists without unmounting the performance route.
function Switcher() {
  const navigate = useNavigate()
  return (
    <button type="button" onClick={() => navigate('/setlists/6/perform')}>switch setlist</button>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PerformancePage', () => {
  it('opens on the first slide and renders its chart', async () => {
    wrap(show([CHART, BARE, PDF]))
    expect(await screen.findByText('Hallelujah')).toBeInTheDocument()
  })

  it('names the set currently playing, and updates it across a set boundary', async () => {
    const user = userEvent.setup()
    const encore = slide({ item_id: 5, title: 'Encore', set_id: 11, set_name: 'Set 2' })
    wrap(show([CHART, encore]))
    await screen.findByText('Hallelujah')
    expect(screen.getByText('Set 1')).toBeInTheDocument()

    await user.keyboard('{ArrowRight}')
    expect(await screen.findByText('Set 2')).toBeInTheDocument()
    expect(screen.queryByText('Set 1')).not.toBeInTheDocument()
  })

  it('opens on the first slide of the set named by ?set=', async () => {
    const encore = slide({ item_id: 5, title: 'Encore', set_id: 11, set_name: 'Set 2' })
    const closer = slide({ item_id: 6, title: 'Last One', set_id: 11, set_name: 'Set 2' })
    wrap(show([CHART, encore, closer]), '?set=11')
    expect(await screen.findByText('Encore')).toBeInTheDocument()
  })

  it('starts at the top when ?set= names a set that is not there', async () => {
    wrap(show([CHART, BARE]), '?set=999')
    expect(await screen.findByText('Hallelujah')).toBeInTheDocument()
  })

  it('still wraps to the very first slide, not to the set it started from', async () => {
    const user = userEvent.setup()
    const encore = slide({ item_id: 5, title: 'Encore', set_id: 11, set_name: 'Set 2' })
    wrap(show([CHART, encore]), '?set=11')
    await screen.findByText('Encore')

    await user.keyboard('{ArrowRight}')
    expect(await screen.findByText('Hallelujah')).toBeInTheDocument()
  })

  it('rebuilds from scratch when the setlist changes under it', async () => {
    const user = userEvent.setup()
    const long = show([CHART, BARE, slide({ item_id: 5, title: 'Third' })])
    const short = { id: 6, name: 'Other', slides: [slide({ item_id: 9, title: 'Only One' })] }
    getSetlistPerformance.mockImplementation((id) => Promise.resolve(id === 6 ? short : long))

    render(
      <ThemeProvider theme={theme}>
        <MemoryRouter initialEntries={['/setlists/5/perform']}>
          <Switcher />
          <Routes>
            <Route path="/setlists/:id/perform" element={<PerformancePage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>,
    )
    await screen.findByText('Hallelujah')
    // Walk to the third slide, a position the shorter setlist doesn't have.
    await user.keyboard('{ArrowRight}')
    await user.keyboard('{ArrowRight}')
    await screen.findByText('Third')

    await user.click(screen.getByRole('button', { name: 'switch setlist' }))
    expect(await screen.findByText('Only One')).toBeInTheDocument()
  })

  it('shows the current slide\'s transition note over the content', async () => {
    wrap(show([CHART, BARE]))
    expect(await screen.findByText('straight into the next one')).toBeInTheDocument()
  })

  it('hides personal notes until asked, keeping the transition note visible', async () => {
    const noted = slide({
      item_id: 7, title: 'Noted', my_note: 'capo 2', transition_note: 'straight in',
    })
    wrap(show([noted]))
    // A personal note can sit over music, so it stays off until wanted.
    expect(await screen.findByText('straight in')).toBeInTheDocument()
    expect(screen.queryByText('capo 2')).not.toBeInTheDocument()
  })

  it('stacks the personal note and the transition note once notes are shown', async () => {
    const user = userEvent.setup()
    const noted = slide({
      item_id: 7, title: 'Noted', my_note: 'capo 2', transition_note: 'straight in',
    })
    wrap(show([noted]))
    await screen.findByText('straight in')

    await user.click(screen.getByRole('button', { name: 'Show personal notes' }))
    expect(await screen.findByText('capo 2')).toBeInTheDocument()
    expect(screen.getByText('straight in')).toBeInTheDocument()
  })

  it('shows a personal note even when there is no transition', async () => {
    const user = userEvent.setup()
    wrap(show([slide({ item_id: 7, title: 'Noted', my_note: 'watch the count-in' })]))
    await screen.findByText('Noted')

    await user.click(screen.getByRole('button', { name: 'Show personal notes' }))
    expect(await screen.findByText('watch the count-in')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Hide personal notes' }))
    expect(screen.queryByText('watch the count-in')).not.toBeInTheDocument()
  })

  it('flips the stage between dark and light', async () => {
    const user = userEvent.setup()
    wrap(show([CHART]))
    await screen.findByText('Hallelujah')

    // The app theme in tests is light, so the stage starts light and offers dark.
    await user.click(screen.getByRole('button', { name: 'Switch to a dark background' }))
    expect(await screen.findByRole('button', { name: 'Switch to a light background' })).toBeInTheDocument()
  })

  it('renders a placeholder slide for a song with no source', async () => {
    wrap(show([BARE]))
    expect(await screen.findByText('Bare Song')).toBeInTheDocument()
    expect(screen.getByText('No chart or sheet music assigned')).toBeInTheDocument()
  })

  it('keeps pause rows in the running order', async () => {
    const pause = slide({ item_id: 4, item_type: 'pause', label: 'Beer' })
    wrap(show([pause]))
    expect(await screen.findByText('Beer')).toBeInTheDocument()
  })

  it('advances to the next song on ArrowRight', async () => {
    const user = userEvent.setup()
    wrap(show([CHART, BARE]))
    await screen.findByText('Hallelujah')

    await user.keyboard('{ArrowRight}')
    expect(await screen.findByText('Bare Song')).toBeInTheDocument()
    // The previous slide's transition note goes with it.
    expect(screen.queryByText('straight into the next one')).not.toBeInTheDocument()
  })

  it.each([['{PageDown}'], ['{Enter}'], ['{ArrowDown}'], [' ']])(
    'advances on %s too, for page-turner pedals',
    async (key) => {
      const user = userEvent.setup()
      wrap(show([CHART, BARE]))
      await screen.findByText('Hallelujah')

      await user.keyboard(key)
      expect(await screen.findByText('Bare Song')).toBeInTheDocument()
    },
  )

  it('wraps from the last slide back to the first', async () => {
    const user = userEvent.setup()
    wrap(show([CHART, BARE]))
    await screen.findByText('Hallelujah')

    await user.keyboard('{ArrowRight}')
    await screen.findByText('Bare Song')
    await user.keyboard('{ArrowRight}')
    expect(await screen.findByText('Hallelujah')).toBeInTheDocument()
  })

  it('wraps backwards from the first slide to the last', async () => {
    const user = userEvent.setup()
    wrap(show([CHART, BARE]))
    await screen.findByText('Hallelujah')

    await user.keyboard('{ArrowLeft}')
    expect(await screen.findByText('Bare Song')).toBeInTheDocument()
  })

  it('pages within a multi-page PDF before moving to the next song', async () => {
    const user = userEvent.setup()
    wrap(show([PDF, BARE]))
    const doc = await screen.findByTestId('pdf-document')
    expect(doc).toHaveAttribute('data-file', '/api/files/tenants/1/song_documents/closer.pdf?inline=1')
    expect(screen.getByTestId('pdf-page')).toHaveAttribute('data-page', '1')

    // Report the 3-page count the way react-pdf would.
    await user.click(screen.getByTestId('pdf-load'))
    await user.keyboard('{ArrowRight}')
    expect(screen.getByTestId('pdf-page')).toHaveAttribute('data-page', '2')
    await user.keyboard('{ArrowRight}')
    expect(screen.getByTestId('pdf-page')).toHaveAttribute('data-page', '3')

    await user.keyboard('{ArrowRight}')
    expect(await screen.findByText('Bare Song')).toBeInTheDocument()
  })

  it('navigates with the overlay areas', async () => {
    const user = userEvent.setup()
    wrap(show([CHART, BARE]))
    await screen.findByText('Hallelujah')

    await user.click(screen.getByRole('button', { name: 'next' }))
    expect(await screen.findByText('Bare Song')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'previous' }))
    expect(await screen.findByText('Hallelujah')).toBeInTheDocument()
  })

  it('reveals the control bar from the centre area, with the slide counter', async () => {
    const user = userEvent.setup()
    wrap(show([CHART, BARE]))
    await screen.findByText('Hallelujah')

    await user.click(screen.getByRole('button', { name: 'show or hide controls' }))
    expect(await screen.findByText('1 of 2')).toBeInTheDocument()
  })

  it('leaves for the editor from the always-visible close button', async () => {
    const user = userEvent.setup()
    wrap(show([CHART, BARE]))
    await screen.findByText('Hallelujah')

    // No need to reveal the controls first.
    await user.click(screen.getByRole('button', { name: 'Exit' }))
    expect(await screen.findByText('editor')).toBeInTheDocument()
  })

  it('leaves for the editor on Escape', async () => {
    const user = userEvent.setup()
    wrap(show([CHART]))
    await screen.findByText('Hallelujah')

    await user.keyboard('{Escape}')
    expect(await screen.findByText('editor')).toBeInTheDocument()
  })

  it('offers a way out of an empty setlist', async () => {
    wrap(show([]))
    expect(await screen.findByText('This setlist is empty, add some songs first.')).toBeInTheDocument()
  })

  it('reports a failed load', async () => {
    getSetlistPerformance.mockRejectedValue(new Error('nope'))
    render(
      <ThemeProvider theme={theme}>
        <MemoryRouter initialEntries={['/setlists/5/perform']}>
          <Routes>
            <Route path="/setlists/:id/perform" element={<PerformancePage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>,
    )
    await waitFor(() => {
      expect(screen.getByText('Failed to load this setlist')).toBeInTheDocument()
    })
  })
})
