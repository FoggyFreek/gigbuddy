import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it, vi } from 'vitest'
import TicketSplitField from '../components/gigdetails/terms/TicketSplitField.tsx'
import theme from '../../../theme.ts'

// The field is controlled, so the harness owns the share the way the deal form
// does: it feeds every reported value straight back in.
function field({ value = '70', disabled = false, help = "The artist's share first." } = {}) {
  const onChange = vi.fn()

  function Harness() {
    const [share, setShare] = useState(value)
    return (
      <TicketSplitField
        label="Ticket percentage"
        complementLabel="Venue / promoter"
        help={help}
        value={share}
        disabled={disabled}
        onChange={(next) => {
          onChange(next)
          setShare(next)
        }}
      />
    )
  }

  render(<ThemeProvider theme={theme}><Harness /></ThemeProvider>)
  return onChange
}

describe('TicketSplitField', () => {
  it('names the pair once and derives the second share', () => {
    field()

    // One label for two boxes: the stored number answers to it, the complement
    // carries its own name for assistive technology.
    expect(screen.getByLabelText('Ticket percentage')).toHaveValue(70)
    expect(screen.getByLabelText('Venue / promoter')).toHaveValue(30)
    // The divider is decoration; it must not be read out between the two.
    expect(screen.getByText('/')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByText('%')).not.toBeInTheDocument()
  })

  it('reports what was typed in the first box', async () => {
    const user = userEvent.setup()
    const onChange = field({ value: '' })

    await user.type(screen.getByLabelText('Ticket percentage'), '60')

    expect(onChange).toHaveBeenLastCalledWith('60')
  })

  it('reports the complement when the second box is typed in', async () => {
    const user = userEvent.setup()
    const onChange = field({ value: '' })

    await user.type(screen.getByLabelText('Venue / promoter'), '40')

    // Only the first share is ever stored, so the pair cannot drift off 100.
    expect(onChange).toHaveBeenLastCalledWith('60')
  })

  it('leaves both shares blank while the first is empty', () => {
    field({ value: '' })

    expect(screen.getByLabelText('Ticket percentage')).toHaveValue(null)
    expect(screen.getByLabelText('Venue / promoter')).toHaveValue(null)
  })

  it('keeps both boxes readable but read-only for a reader', () => {
    field({ disabled: true })

    expect(screen.getByLabelText('Ticket percentage')).toHaveAttribute('readonly')
    expect(screen.getByLabelText('Venue / promoter')).toHaveAttribute('readonly')
  })

  it('offers the explanation behind a help icon', async () => {
    const user = userEvent.setup()
    field()

    await user.hover(screen.getByRole('button', { name: /more information/i }))
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/the artist's share first/i)
  })
})
