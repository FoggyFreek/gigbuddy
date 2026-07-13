import { render } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it } from 'vitest'

import ChordProView from '../components/chordpro/ChordProView.tsx'
import { CHORDPRO_PRINT_CSS } from '../utils/chordpro.ts'
import theme from '../theme.ts'

function wrap(source) {
  return render(
    <ThemeProvider theme={theme}>
      <ChordProView source={source} />
    </ThemeProvider>,
  )
}

describe('ChordProView', () => {
  it('renders chord diagrams in a print-only block while print CSS hides the expandable control', () => {
    const { container } = wrap('{diagrams: off}\n[C]Hello [G]world')

    expect(container.querySelector('.cp-diagrams-collapsible')).not.toBeInTheDocument()
    expect(container.querySelectorAll('.cp-diagrams-print .cp-diagram')).toHaveLength(2)
    expect(CHORDPRO_PRINT_CSS).toContain('.cp-diagrams-collapsible { display: none; }')
    expect(CHORDPRO_PRINT_CSS).toContain('.cp-diagrams-print { display: block; }')
  })

  it('visualizes lowercase chord roots as resolved fretboard diagrams', () => {
    const { container } = wrap('[cadd9]One [g]two [d]three [em]four')
    const diagrams = container.querySelectorAll('.cp-diagrams-print .cp-diagram')

    expect(diagrams).toHaveLength(4)
    expect(container.querySelectorAll('.cp-diagrams-print .cp-diagram svg')).toHaveLength(4)
    expect([...diagrams].map((diagram) => diagram.firstElementChild.textContent)).toEqual(['Cadd9', 'G', 'D', 'Em'])
  })
})
