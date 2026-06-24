import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it, vi } from 'vitest'
import InteractiveFretboard from '../components/chordpro/InteractiveFretboard.tsx'
import theme from '../theme.ts'

const MUTED = [-1, -1, -1, -1, -1, -1]

// Controlled harness so toggling reflects back into the rendered state.
function Harness({ initial = MUTED, onChange }) {
  const [frets, setFrets] = useState(initial)
  return (
    <ThemeProvider theme={theme}>
      <InteractiveFretboard
        frets={frets}
        onChange={(next) => {
          setFrets(next)
          onChange?.(next)
        }}
      />
    </ThemeProvider>
  )
}

describe('InteractiveFretboard', () => {
  it('sets a string fret when its cell is clicked', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Set low E string to fret 3' }))
    expect(onChange).toHaveBeenCalledWith([3, -1, -1, -1, -1, -1])
  })

  it('mutes the string when the active fret is clicked again', async () => {
    const onChange = vi.fn()
    render(<Harness initial={[3, -1, -1, -1, -1, -1]} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Set low E string to fret 3' }))
    expect(onChange).toHaveBeenLastCalledWith([-1, -1, -1, -1, -1, -1])
  })

  it('toggles a string open then muted via the nut button', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const nut = () => screen.getByRole('button', { name: /Toggle high e string open or muted/ })
    await userEvent.click(nut()) // muted -> open
    expect(onChange).toHaveBeenLastCalledWith([-1, -1, -1, -1, -1, 0])
    await userEvent.click(nut()) // open -> muted
    expect(onChange).toHaveBeenLastCalledWith([-1, -1, -1, -1, -1, -1])
  })

  it('shows the open string note instead of an o marker', async () => {
    render(<Harness />)
    const nut = screen.getByRole('button', { name: /Toggle high e string open or muted/ })

    await userEvent.click(nut)

    expect(nut).toHaveTextContent('E')
    expect(nut).not.toHaveTextContent('o')
  })

  it('responds to keyboard activation (Enter/Space) on a focused fret cell', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const cell = screen.getByRole('button', { name: 'Set A string to fret 2' })
    cell.focus()
    await userEvent.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledWith([-1, 2, -1, -1, -1, -1])
  })

  it('marks the active fret cell with aria-pressed', () => {
    render(<Harness initial={[-1, 0, 2, 2, 1, 0]} />)
    expect(screen.getByRole('button', { name: 'Set D string to fret 2' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Set D string to fret 1' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows the sounded note name inside a placed fret cell', () => {
    // Am [-1,0,2,2,1,0]: D str fret2 = E, G str fret2 = A, B str fret1 = C.
    render(<Harness initial={[-1, 0, 2, 2, 1, 0]} />)
    expect(screen.getByRole('button', { name: 'Set D string to fret 2' })).toHaveTextContent('E')
    expect(screen.getByRole('button', { name: 'Set G string to fret 2' })).toHaveTextContent('A')
    expect(screen.getByRole('button', { name: 'Set B string to fret 1' })).toHaveTextContent('C')
  })
})

