import { render, screen } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it } from 'vitest'
import ChordDiagram from '../components/ChordDiagram.tsx'
import theme from '../theme.ts'

function wrap(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

const C_SHAPE = { baseFret: 1, frets: [-1, 3, 2, 0, 1, 0], fingers: [0, 3, 2, 0, 1, 0] }

describe('ChordDiagram', () => {
  it('draws a fretboard SVG for a known shape', () => {
    const { container } = wrap(<ChordDiagram name="C" shape={C_SHAPE} />)
    expect(screen.getByText('C')).toBeInTheDocument()
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('shows the chord name without a fretboard when no shape is known', () => {
    const { container } = wrap(<ChordDiagram name="N.C." shape={null} />)
    expect(screen.getByText('N.C.')).toBeInTheDocument()
    expect(container.querySelector('svg')).not.toBeInTheDocument()
  })

  it('shows the name without a fretboard when the shape has no frets', () => {
    const { container } = wrap(<ChordDiagram name="C" shape={{ baseFret: 1, frets: [] }} />)
    expect(screen.getByText('C')).toBeInTheDocument()
    expect(container.querySelector('svg')).not.toBeInTheDocument()
  })

  it('renders the base-fret number instead of a nut for higher positions', () => {
    // baseFret 3 (e.g. a barre Gm) labels the position rather than drawing the nut.
    wrap(<ChordDiagram name="Gm" shape={{ baseFret: 3, frets: [1, 3, 3, 1, 1, 1] }} />)
    expect(screen.getByText('3')).toBeInTheDocument()
  })
})
