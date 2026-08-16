import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { updateSongChart } from '../songs.ts'
import { printChordPro } from '../chordpro.ts'

let mockStacked = false
vi.mock('@mui/material/useMediaQuery', () => ({
  default: () => mockStacked,
}))

vi.mock('../components/chordpro/ChordProView.tsx', () => ({
  default: ({ source }) => <div>Rendered chart: {source}</div>,
}))

vi.mock('../songs.ts', () => ({
  updateSongChart: vi.fn(),
}))

// Keep MONO_FONT (used in editor styling) but stub the browser-print helper —
// it opens a window jsdom can't drive.
vi.mock('../chordpro.ts', async (importOriginal) => ({
  ...(await importOriginal()),
  printChordPro: vi.fn(),
}))

import ChordProViewerDialog from '../components/chordpro/ChordProViewerDialog.tsx'
import theme from '../../../theme.ts'

const CHART = {
  id: 10,
  name: 'Guitar',
  source: '[C]Hello',
}

function wrap(props = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <ChordProViewerDialog
        open
        songId={1}
        chart={CHART}
        canWrite
        startInEdit
        onClose={() => {}}
        onChartChange={() => {}}
        {...props}
      />
    </ThemeProvider>,
  )
}

describe('ChordProViewerDialog', () => {
  beforeEach(() => {
    mockStacked = false
    updateSongChart.mockReset()
    updateSongChart.mockResolvedValue(CHART)
    vi.mocked(printChordPro).mockClear()
  })

  it('keeps the live preview next to the editor on wide screens', () => {
    wrap()

    expect(screen.getByLabelText(/chordpro source/i)).toBeInTheDocument()
    expect(screen.getByText('Rendered chart: [C]Hello')).toBeInTheDocument()
  })

  it('hides the edit-mode preview on compact screens until Preview is clicked', async () => {
    mockStacked = true
    const user = userEvent.setup()
    wrap()

    expect(screen.getByLabelText(/chordpro source/i)).toBeInTheDocument()
    expect(screen.queryByText('Rendered chart: [C]Hello')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^preview$/i }))

    expect(screen.getByText('Rendered chart: [C]Hello')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument()
  })

  it('opens the read-only chord finder without touching the chart', async () => {
    const user = userEvent.setup()
    wrap()

    expect(screen.queryByRole('group', { name: /guitar fretboard/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /toggle chord finder/i }))

    const board = screen.getByRole('group', { name: /guitar fretboard/i })
    // Use the finder to identify a chord — must not persist anything to the chart.
    await user.click(within(board).getByRole('button', { name: 'Set A string to fret 3' }))
    expect(updateSongChart).not.toHaveBeenCalled()
  })

  it('shows only seven fret columns in the compact chord finder', async () => {
    mockStacked = true
    const user = userEvent.setup()
    wrap()

    await user.click(screen.getByRole('button', { name: /toggle chord finder/i }))

    const board = screen.getByRole('group', { name: /guitar fretboard/i })
    expect(within(board).getByRole('button', { name: 'Set A string to fret 7' })).toBeInTheDocument()
    expect(within(board).queryByRole('button', { name: 'Set A string to fret 8' })).not.toBeInTheDocument()
  })

  it('auto-saves edits to the ChordPro source and propagates the result', async () => {
    const updated = { ...CHART, source: '[D]Yo' }
    updateSongChart.mockResolvedValue(updated)
    const onChartChange = vi.fn()
    wrap({ onChartChange })

    fireEvent.change(screen.getByLabelText(/chordpro source/i), { target: { value: '[D]Yo' } })

    await waitFor(
      () => expect(updateSongChart).toHaveBeenCalledWith(1, 10, { source: '[D]Yo' }),
      { timeout: 2000 }
    )
    await waitFor(() => expect(onChartChange).toHaveBeenCalledWith(updated))
  })

  it('shows five scrollable, caret-anchored suggestions and filters after an opening brace', async () => {
    wrap({ chart: { ...CHART, source: '' } })
    const editor = screen.getByLabelText(/chordpro source/i)

    fireEvent.change(editor, { target: { value: '{', selectionStart: 1 } })

    const listbox = screen.getByRole('listbox', { name: /chordpro suggestions/i })
    expect(listbox).toHaveStyle({ maxHeight: '256px', overflowY: 'auto' })
    await waitFor(() => expect(screen.getByTestId('chordpro-suggestion-popper')).toHaveAttribute('data-popper-placement', 'bottom-start'))
    expect(screen.getByRole('option', { name: /\{title: \}/i })).toHaveTextContent('Sets the document title.')

    fireEvent.change(editor, { target: { value: '{start_of_ch', selectionStart: 12 } })

    expect(screen.getByRole('option', { name: /\{start_of_chorus: \}/i })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /\{title: \}/i })).not.toBeInTheDocument()

    fireEvent.change(editor, { target: { value: '{verse', selectionStart: 6 } })

    expect(screen.getByRole('option', { name: /\{start_of_verse: \}/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /\{end_of_verse\}/i })).toBeInTheDocument()
  })

  it('uses arrow keys and Tab to insert an argument directive', async () => {
    wrap({ chart: { ...CHART, source: '' } })
    const editor = screen.getByLabelText(/chordpro source/i)

    fireEvent.change(editor, { target: { value: '{comment', selectionStart: 8 } })
    fireEvent.keyDown(editor, { key: 'ArrowUp' })
    expect(screen.getByRole('option', { name: /\{comment_italic: \}/i })).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(editor, { key: 'ArrowDown' })
    fireEvent.keyDown(editor, { key: 'ArrowDown' })
    fireEvent.keyDown(editor, { key: 'Tab' })

    expect(editor).toHaveValue('{comment_box: }')
    await waitFor(() => expect(editor).toHaveFocus())
    expect(editor.selectionStart).toBe('{comment_box: '.length)
    expect(editor.selectionEnd).toBe('{comment_box: '.length)
    expect(screen.queryByRole('listbox', { name: /chordpro suggestions/i })).not.toBeInTheDocument()
  })

  it('inserts a complete block and moves the caret to its argument', async () => {
    wrap({ chart: { ...CHART, source: '' } })
    const editor = screen.getByLabelText(/chordpro source/i)

    fireEvent.change(editor, { target: { value: '{start_of_ch', selectionStart: 12 } })
    fireEvent.keyDown(editor, { key: 'Tab' })

    expect(editor).toHaveValue('{start_of_chorus: }\n\n{end_of_chorus}')
    await waitFor(() => expect(editor.selectionStart).toBe('{start_of_chorus: '.length))
  })

  it.each([
    [
      'ABC',
      '{start_of_abc',
      '{start_of_abc: }\nX:1\nM:4/4\nL:1/4\nK:C\nC D E F |\n{end_of_abc}',
    ],
    [
      'tablature',
      '{start_of_tab',
      '{start_of_tab: }\ne|--0--------------|\nB|----3------------|\nG|---2-------------|\nD|-----------------|\nA|-----------------|\nE|-----------------|\n{end_of_tab}',
    ],
    [
      'grid',
      '{start_of_grid',
      '{start_of_grid: }\n|| C . . . | F . . . | G . . . | C . . . ||\n{end_of_grid}',
    ],
  ])('adds a starter snippet inside a new %s block', (_name, source, expected) => {
    wrap({ chart: { ...CHART, source: '' } })
    const editor = screen.getByLabelText(/chordpro source/i)

    fireEvent.change(editor, { target: { value: source, selectionStart: source.length } })
    fireEvent.keyDown(editor, { key: 'Tab' })

    expect(editor).toHaveValue(expected)
    expect(editor.selectionStart).toBe(`${source}: `.length)
  })

  it('auto-saves the chart name, trimmed', async () => {
    wrap()

    fireEvent.change(screen.getByPlaceholderText(/chart name/i), { target: { value: '  Piano  ' } })

    await waitFor(
      () => expect(updateSongChart).toHaveBeenCalledWith(1, 10, { name: 'Piano' }),
      { timeout: 2000 }
    )
  })

  it('does not save a blank chart name', async () => {
    wrap()

    fireEvent.change(screen.getByPlaceholderText(/chart name/i), { target: { value: '   ' } })
    // Let the debounce window pass; a blank name must never schedule a save.
    await new Promise((r) => setTimeout(r, 700))

    expect(updateSongChart).not.toHaveBeenCalled()
  })

  it('flushes a pending edit before closing', async () => {
    const updated = { ...CHART, source: '[E]Hey' }
    updateSongChart.mockResolvedValue(updated)
    const onClose = vi.fn()
    const user = userEvent.setup()
    wrap({ onClose })

    fireEvent.change(screen.getByLabelText(/chordpro source/i), { target: { value: '[E]Hey' } })
    // Close immediately, before the 600ms debounce would have fired: handleClose
    // flushes the pending save first, then calls onClose.
    await user.click(screen.getByRole('button', { name: /^close$/i }))

    expect(updateSongChart).toHaveBeenCalledWith(1, 10, { source: '[E]Hey' })
    expect(onClose).toHaveBeenCalled()
  })

  it('prints the rendered chart', async () => {
    const user = userEvent.setup()
    wrap()

    await user.click(screen.getByRole('button', { name: /print/i }))

    expect(printChordPro).toHaveBeenCalledWith(expect.anything(), '[C]Hello', 'Guitar')
  })

  it('deletes the chart after confirming, then closes', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    const user = userEvent.setup()
    wrap({ onDelete, onClose })

    await user.click(screen.getByRole('button', { name: /delete chart/i }))
    const confirm = screen.getByRole('dialog', { name: /delete chart\?/i })
    await user.click(within(confirm).getByRole('button', { name: /^delete$/i }))

    expect(onDelete).toHaveBeenCalled()
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('cancels deletion without calling onDelete', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    wrap({ onDelete })

    await user.click(screen.getByRole('button', { name: /delete chart/i }))
    const confirm = screen.getByRole('dialog', { name: /delete chart\?/i })
    await user.click(within(confirm).getByRole('button', { name: /cancel/i }))

    expect(onDelete).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /delete chart\?/i })).not.toBeInTheDocument()
    )
  })

  it('shows no delete affordance when onDelete is not provided', () => {
    wrap()
    expect(screen.queryByRole('button', { name: /delete chart/i })).not.toBeInTheDocument()
  })

  it('omits the Edit button and starts in view mode for readers', () => {
    wrap({ canWrite: false, startInEdit: true })

    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/chordpro source/i)).not.toBeInTheDocument()
    expect(screen.getByText('Rendered chart: [C]Hello')).toBeInTheDocument()
  })

  it('transposes the preview up and resets back to zero', async () => {
    const user = userEvent.setup()
    wrap()

    await user.click(screen.getByRole('button', { name: /transpose up/i }))
    expect(screen.getByRole('button', { name: /transpose 1 semitones, reset/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /transpose 1 semitones, reset/i }))
    expect(screen.getByRole('button', { name: /transpose 0 semitones/i })).toBeInTheDocument()
  })
})
