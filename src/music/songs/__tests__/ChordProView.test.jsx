import { render } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it } from 'vitest'

import ChordProView from '../components/chordpro/ChordProView.tsx'
import { CHORDPRO_PRINT_CSS } from '../chordpro.ts'
import theme from '../../../theme.ts'

function wrap(source, props = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <ChordProView source={source} {...props} />
    </ThemeProvider>,
  )
}

describe('ChordProView', () => {
  it('uses smaller chart text in compact layouts', () => {
    const { container } = wrap('[C]Hello', { compact: true })

    expect(container.querySelector('.cp-doc')).toHaveStyle({ fontSize: '14px' })
  })

  it('suppresses chord diagrams on screen and in print when diagrams are off', () => {
    const { container } = wrap('{diagrams: off}\n[C]Hello [G]world')

    expect(container.querySelector('.cp-diagrams-collapsible')).not.toBeInTheDocument()
    expect(container.querySelector('.cp-diagrams-print')).not.toBeInTheDocument()
    expect(CHORDPRO_PRINT_CSS).toContain('.cp-diagrams-collapsible { display: none; }')
    expect(CHORDPRO_PRINT_CSS).toContain('.cp-diagrams-print { display: block; }')
  })

  it('places bottom diagrams after the song flow and top diagrams before it', () => {
    const bottom = wrap('{diagrams: bottom}\n[C]Hello').container.querySelector('.cp-doc')
    expect(bottom.querySelector('.cp-flow').compareDocumentPosition(bottom.querySelector('.cp-diagrams-print')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    const top = wrap('{diagrams: top}\n[C]Hello').container.querySelector('.cp-doc')
    expect(top.querySelector('.cp-diagrams-print').compareDocumentPosition(top.querySelector('.cp-flow')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('uses CSS multi-column flow and emits forced column/page break markers', () => {
    const { container } = wrap('{columns: 2}\n[C]One\n{colb}\n[D]Two\n{new_page}\n[E]Three')
    const flow = container.querySelector('.cp-flow')

    expect(flow).toHaveClass('cp-columns-2')
    expect(flow.querySelector('.cp-column-break')).toBeInTheDocument()
    expect(flow.querySelector('.cp-page-break')).toBeInTheDocument()
  })

  it('renders whitespace-form section labels in a compact shared lane', () => {
    const { container } = wrap('{start_of_verse label="Verse 1"}\n[C]Line\n{end_of_verse}')
    expect(container.querySelector('.paragraph > .label')).toHaveTextContent(/^Verse 1$/)
    expect(container.querySelector('.cp-doc').style.getPropertyValue('--cp-label-width')).toBe('42px')
    expect(container.querySelector('.cp-doc').style.getPropertyValue('--cp-label-gap')).toBe('8px')
  })

  it('places below diagrams at the directive and right diagrams beside the flow', () => {
    const below = wrap('[C]Before\n{diagrams: below}\n[D]After').container
    expect(below.querySelector('.cp-flow .cp-diagram-placement')).toBeInTheDocument()

    const right = wrap('{diagrams: right}\n[C]Line').container
    expect(right.querySelector('.cp-side-layout > .cp-flow')).toBeInTheDocument()
    expect(right.querySelector('.cp-side-layout > .cp-diagram-placement')).toBeInTheDocument()
  })

  it('stacks side diagrams vertically, with left placing them before the flow', () => {
    const right = wrap('{diagrams: right}\n[C]Line [G]two', { diagramsOpen: true }).container
    const rightLayout = right.querySelector('.cp-side-layout')
    expect(rightLayout).toHaveClass('cp-side-layout-right')
    expect(rightLayout.firstElementChild).toHaveClass('cp-flow')
    expect(right.querySelector('.cp-diagrams')).toHaveClass('cp-diagrams-vertical')
    expect(right.querySelector('.cp-diagrams-collapsible .cp-diagrams')).toHaveStyle({ flexDirection: 'column', flexWrap: 'nowrap' })

    const left = wrap('{diagrams: left}\n[C]Line [G]two', { diagramsOpen: true }).container
    const leftLayout = left.querySelector('.cp-side-layout')
    expect(leftLayout).toHaveClass('cp-side-layout-left')
    expect(leftLayout.firstElementChild).toHaveClass('cp-diagram-placement')
    expect(left.querySelector('.cp-diagrams')).toHaveClass('cp-diagrams-vertical')

    const bottom = wrap('{diagrams: bottom}\n[C]Line [G]two', { diagramsOpen: true }).container
    expect(bottom.querySelector('.cp-diagrams')).not.toHaveClass('cp-diagrams-vertical')

    expect(CHORDPRO_PRINT_CSS).toContain('.cp-diagrams-vertical { flex-direction: column; flex-wrap: nowrap;')
    expect(CHORDPRO_PRINT_CSS).toContain('.cp-side-layout-left { grid-template-columns: auto minmax(0, 1fr); }')
  })

  it('collapses a side diagram layout to one wrapping column on compact screens', () => {
    const { container } = wrap('{diagrams: right}\n[C]Line [G]two', { compact: true, diagramsOpen: true })

    expect(container.querySelector('.cp-side-layout')).toHaveStyle({ gridTemplateColumns: '1fr' })
    // Print keeps the side column, so the class stays — only the screen grid wraps.
    expect(container.querySelector('.cp-diagrams')).toHaveClass('cp-diagrams-vertical')
    expect(container.querySelector('.cp-diagrams-collapsible .cp-diagrams')).toHaveStyle({ flexDirection: 'row', flexWrap: 'wrap' })
  })

  it('renders keyboard definitions and shared labels for image/text blocks', () => {
    const source = [
      '{define: D keys 0 4 7}',
      '[D]Keyboard',
      '{start_of_textblock label="Note"}',
      'Words',
      '{end_of_textblock}',
      '{image: "https://example.com/pic.png" label="Picture" border}',
    ].join('\n')
    const { container } = wrap(source)
    expect(container.querySelector('.cp-keyboard-diagram')).toBeInTheDocument()
    expect([...container.querySelectorAll('.cp-section-label')].map((node) => node.textContent)).toEqual(['Note', 'Picture'])
    expect(container.querySelector('.cp-image img').style.borderWidth).toBe('1pt')
  })

  it('renders a visible chorus recall marker with an optional margin label', () => {
    const source = [
      '{start_of_chorus label="Chorus"}',
      '[C]Sing it',
      '{end_of_chorus}',
      '{chorus}',
      '{chorus: label="Final"}',
    ].join('\n')
    const { container } = wrap(source)
    const recalls = container.querySelectorAll('.cp-chorus-recall')

    expect(recalls).toHaveLength(2)
    expect([...recalls].map((node) => node.textContent)).toEqual(['Chorus', 'Chorus'])
    expect(container.querySelector('.cp-chorus-recall-wrap > .cp-section-label')).toHaveTextContent(/^Final$/)
  })

  it('visualizes lowercase chord roots as resolved fretboard diagrams', () => {
    const { container } = wrap('[cadd9]One [g]two [d]three [em]four')
    const diagrams = container.querySelectorAll('.cp-diagrams-print .cp-diagram')

    expect(diagrams).toHaveLength(4)
    expect(container.querySelectorAll('.cp-diagrams-print .cp-diagram svg')).toHaveLength(4)
    expect([...diagrams].map((diagram) => diagram.firstElementChild.textContent)).toEqual(['Cadd9', 'G', 'D', 'Em'])
  })
})
