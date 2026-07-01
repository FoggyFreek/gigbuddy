import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it, vi } from 'vitest'
import ChordAnalyzerPanel from '../components/chordpro/ChordAnalyzerPanel.tsx'
import theme from '../theme.ts'

function wrap(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

// Build an open C major [-1, 3, 2, 0, 1, 0] by clicking the neck.
async function playOpenC() {
  await userEvent.click(screen.getByRole('button', { name: 'Set A string to fret 3' }))
  await userEvent.click(screen.getByRole('button', { name: 'Set D string to fret 2' }))
  await userEvent.click(screen.getByRole('button', { name: /Toggle G string open or muted/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Set B string to fret 1' }))
  await userEvent.click(screen.getByRole('button', { name: /Toggle high e string open or muted/ }))
}

describe('ChordAnalyzerPanel', () => {
  it('shows an empty state before any notes are chosen', () => {
    wrap(<ChordAnalyzerPanel />)
    expect(screen.getByText(/No notes selected/)).toBeInTheDocument()
  })

  it('identifies the chord spelled by the selected notes', async () => {
    wrap(<ChordAnalyzerPanel />)
    await playOpenC()
    expect(screen.getByRole('heading', { name: 'C' })).toBeInTheDocument()
    expect(screen.getByText('C · E · G')).toBeInTheDocument()
  })

  it('Clear resets the board back to the empty state', async () => {
    wrap(<ChordAnalyzerPanel />)
    await playOpenC()
    expect(screen.getByRole('heading', { name: 'C' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByText(/No notes selected/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled()
  })

  it('offers no "Add to chart" action for read-only viewers', async () => {
    wrap(<ChordAnalyzerPanel />)
    await playOpenC()
    expect(screen.queryByRole('button', { name: 'Add to chart' })).not.toBeInTheDocument()
  })

  it('adds the identified chord and its voicing as a {define} directive', async () => {
    const onAddToChart = vi.fn()
    wrap(<ChordAnalyzerPanel onAddToChart={onAddToChart} />)
    await playOpenC()
    await userEvent.click(screen.getByRole('button', { name: 'Add to chart' }))
    expect(onAddToChart).toHaveBeenCalledWith('C', '{define: C base-fret 1 frets x 3 2 0 1 0}')
  })
})
