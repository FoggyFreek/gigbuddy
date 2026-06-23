import { render } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it } from 'vitest'

import ChordProView from '../components/ChordProView.tsx'
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
})
