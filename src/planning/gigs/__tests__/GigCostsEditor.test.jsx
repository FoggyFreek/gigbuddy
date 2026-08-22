import { render, screen, waitFor, waitForElementToBeRemoved } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import GigCostsEditor from '../components/gigdetails/terms/GigCostsEditor.tsx'
import { DialogProvider } from '../../../contexts/DialogContext.tsx'
import theme from '../../../theme.ts'

const COSTS = [
  { id: 41, label: 'Travel', amount_cents: 12500, position: 0 },
  { id: 42, label: 'Catering', amount_cents: 2500, position: 1 },
]

function wrap({ costs = COSTS, editable = true, onAdd = vi.fn().mockResolvedValue(undefined), onUpdate = vi.fn().mockResolvedValue(undefined), onDelete = vi.fn().mockResolvedValue(undefined) } = {}) {
  render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <DialogProvider>
          <GigCostsEditor editable={editable} costs={costs} onAdd={onAdd} onUpdate={onUpdate} onDelete={onDelete} />
        </DialogProvider>
      </ThemeProvider>
    </MemoryRouter>,
  )
  return { onAdd, onUpdate, onDelete }
}

function draftInputs() {
  const labels = screen.getAllByLabelText(/^cost$/i)
  const amounts = screen.getAllByLabelText(/^amount$/i)
  return { label: labels.at(-1), amount: amounts.at(-1) }
}

describe('GigCostsEditor', () => {
  it('renders the itemised total and keeps a disabled empty draft from submitting', () => {
    const { onAdd } = wrap()

    expect(screen.getByTestId('gig-costs-total')).toHaveTextContent('€ 150,00')
    expect(screen.getByRole('button', { name: /^add$/i })).toBeDisabled()
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('adds a default artist-paid cost and clears the draft after success', async () => {
    const user = userEvent.setup()
    const { onAdd } = wrap()
    const { label, amount } = draftInputs()

    await user.type(label, 'Backline')
    await user.type(amount, '75')
    await user.click(screen.getByRole('button', { name: /^add$/i }))

    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('Backline', 7500, 'artist'))
    expect(draftInputs().label).toHaveValue('')
  })

  it('uses the selected payer for a new cost', async () => {
    const user = userEvent.setup()
    const { onAdd } = wrap()
    const { label, amount } = draftInputs()

    await user.type(label, 'Backline')
    await user.type(amount, '75')
    await user.click(screen.getAllByLabelText(/^paid by$/i).at(-1))
    await user.click(await screen.findByRole('option', { name: 'Agency' }))
    await user.click(screen.getByRole('button', { name: /^add$/i }))

    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('Backline', 7500, 'agency'))
  })

  it('supports Enter and preserves an unsuccessful draft for correction', async () => {
    const user = userEvent.setup()
    const onAdd = vi.fn().mockRejectedValue(new Error('A gig can have at most 50 cost lines'))
    wrap({ onAdd })
    const { label, amount } = draftInputs()

    await user.type(label, 'Backline')
    await user.type(amount, '75{Enter}')

    await waitFor(() => expect(screen.getByText(/at most 50 cost lines/i)).toBeInTheDocument())
    expect(onAdd).toHaveBeenCalledWith('Backline', 7500, 'artist')
    expect(draftInputs().label).toHaveValue('Backline')
  })

  it('saves a changed row on blur but skips unchanged rows', async () => {
    const user = userEvent.setup()
    const { onUpdate } = wrap()
    const travel = screen.getByDisplayValue('Travel')

    await user.click(travel)
    await user.tab()
    expect(onUpdate).not.toHaveBeenCalled()

    await user.clear(travel)
    await user.type(travel, 'Travel (van)')
    await user.tab()
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(41, 'Travel (van)', 12500, 'artist'))
  })

  it('saves a changed payer immediately', async () => {
    const user = userEvent.setup()
    const { onUpdate } = wrap()

    await user.click(screen.getAllByLabelText(/^paid by$/i)[0])
    await user.click(await screen.findByRole('option', { name: 'Artist/Agency' }))

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(41, 'Travel', 12500, 'artist_agency'))
  })

  it('restores a rejected edit instead of leaving an unsaved row on screen', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn().mockRejectedValue(new Error('Invalid label'))
    wrap({ onUpdate })
    const travel = screen.getByDisplayValue('Travel')

    await user.clear(travel)
    await user.type(travel, 'Something else')
    await user.tab()

    await waitFor(() => expect(screen.getByText('Invalid label')).toBeInTheDocument())
    expect(screen.getByDisplayValue('Travel')).toBeInTheDocument()
  })

  it('requires confirmation before deleting a cost', async () => {
    const user = userEvent.setup()
    const { onDelete } = wrap()

    await user.click(screen.getAllByRole('button', { name: /delete cost/i })[0])
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent(/delete "travel"\?/i)
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onDelete).not.toHaveBeenCalled()

    await waitForElementToBeRemoved(() => screen.queryByRole('dialog'))
    await user.click(screen.getAllByRole('button', { name: /delete cost/i })[0])
    await user.click(await screen.findByRole('button', { name: /^delete$/i }))
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(41))
  })
})
