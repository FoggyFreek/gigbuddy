import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../gigs.ts', () => ({
  addGigInfoBlock: vi.fn(),
  updateGigInfoBlock: vi.fn(),
  deleteGigInfoBlock: vi.fn(),
}))

import GigInfoBlocks from '../components/gigdetails/GigInfoBlocks.tsx'
import { DialogProvider } from '../../../contexts/DialogContext.tsx'
import { addGigInfoBlock, deleteGigInfoBlock, updateGigInfoBlock } from '../gigs.ts'
import theme from '../../../theme.ts'

function wrap(ui) {
  return render(
    <ThemeProvider theme={theme}><MemoryRouter><DialogProvider>
      {ui}
    </DialogProvider></MemoryRouter></ThemeProvider>,
  )
}

function renderBlocks({ blocks = [], editable = true } = {}) {
  return wrap(<GigInfoBlocks gigId={1} editable={editable} initialBlocks={blocks} />)
}

// Content saves debounce at 600ms, past waitFor's default budget.
const SAVED = { timeout: 3000 }

const REMARKS = {
  id: 5,
  label: 'remarks',
  label_is_custom: false,
  content: 'Bring own PA',
  position: 0,
}

// The label doubles as the block's caption, so the content field is reached by
// the label it is filed under.
function contentField(label) {
  return screen.getByLabelText(label)
}

beforeEach(() => {
  vi.clearAllMocks()
  addGigInfoBlock.mockImplementation(async (_gigId, body) => ({
    id: 99, position: 0, content: '', ...body,
  }))
  updateGigInfoBlock.mockResolvedValue({})
  deleteGigInfoBlock.mockResolvedValue(undefined)
})

describe('GigInfoBlocks', () => {
  it('shows a Remarks block on a gig that has none stored', () => {
    renderBlocks()
    expect(screen.getByDisplayValue('Remarks / Notes')).toBeInTheDocument()
    expect(contentField('Remarks / Notes')).toHaveValue('')
  })

  it('renders the stored blocks with their labels and text', () => {
    renderBlocks({
      blocks: [
        REMARKS,
        { id: 6, label: 'dressing_room', label_is_custom: false, content: 'Upstairs', position: 1 },
        { id: 7, label: 'Shuttle bus', label_is_custom: true, content: '23:00', position: 2 },
      ],
    })
    expect(contentField('Remarks / Notes')).toHaveValue('Bring own PA')
    // A canonical label is translated for display; a typed one is shown verbatim.
    expect(contentField('Dressing room')).toHaveValue('Upstairs')
    expect(contentField('Shuttle bus')).toHaveValue('23:00')
  })

  it('creates the Remarks block the first time it is written to', async () => {
    const user = userEvent.setup()
    renderBlocks()
    await user.type(contentField('Remarks / Notes'), 'Load in at 17:00')

    await waitFor(() => expect(addGigInfoBlock).toHaveBeenCalledWith(1, {
      label: 'remarks',
      label_is_custom: false,
      content: 'Load in at 17:00',
    }), SAVED)
    expect(addGigInfoBlock).toHaveBeenCalledTimes(1)
  })

  it('patches an existing block rather than creating another', async () => {
    const user = userEvent.setup()
    renderBlocks({ blocks: [REMARKS] })
    await user.type(contentField('Remarks / Notes'), ' and a DI')

    await waitFor(
      () => expect(updateGigInfoBlock).toHaveBeenCalledWith(1, 5, { content: 'Bring own PA and a DI' }),
      SAVED,
    )
    expect(addGigInfoBlock).not.toHaveBeenCalled()
  })

  it('creates the block only once when it is typed into repeatedly', async () => {
    const user = userEvent.setup()
    renderBlocks()
    await user.type(contentField('Remarks / Notes'), 'First')
    await waitFor(() => expect(addGigInfoBlock).toHaveBeenCalledTimes(1), SAVED)

    await user.type(contentField('Remarks / Notes'), ' second')
    // The id handed back by the create is what the follow-up write goes to.
    await waitFor(
      () => expect(updateGigInfoBlock).toHaveBeenCalledWith(1, 99, { content: 'First second' }),
      SAVED,
    )
    expect(addGigInfoBlock).toHaveBeenCalledTimes(1)
  })

  it('stores a picked suggestion as its canonical key', async () => {
    const user = userEvent.setup()
    renderBlocks({ blocks: [REMARKS] })
    await user.click(screen.getByRole('button', { name: /add info block/i }))

    const labelFields = screen.getAllByLabelText('Label')
    await user.type(labelFields[labelFields.length - 1], 'Timet')
    await user.click(await screen.findByRole('option', { name: 'Timetable' }))

    await waitFor(() => expect(addGigInfoBlock).toHaveBeenCalledWith(1, {
      label: 'timetable',
      label_is_custom: false,
      content: '',
    }))
  })

  it('keeps a label the user typed themselves', async () => {
    const user = userEvent.setup()
    renderBlocks({ blocks: [REMARKS] })
    await user.click(screen.getByRole('button', { name: /add info block/i }))

    const labelFields = screen.getAllByLabelText('Label')
    await user.type(labelFields[labelFields.length - 1], 'Shuttle bus')
    await user.tab()

    await waitFor(() => expect(addGigInfoBlock).toHaveBeenCalledWith(1, {
      label: 'Shuttle bus',
      label_is_custom: true,
      content: '',
    }))
  })

  it('snaps a hand-typed suggestion back onto its key', async () => {
    const user = userEvent.setup()
    renderBlocks({ blocks: [REMARKS] })
    await user.click(screen.getByRole('button', { name: /add info block/i }))

    const labelFields = screen.getAllByLabelText('Label')
    await user.type(labelFields[labelFields.length - 1], 'catering')
    await user.tab()

    await waitFor(() => expect(addGigInfoBlock).toHaveBeenCalledWith(1, {
      label: 'catering',
      label_is_custom: false,
      content: '',
    }))
  })

  it('relabels an existing block without touching its text', async () => {
    const user = userEvent.setup()
    renderBlocks({ blocks: [REMARKS] })
    await user.clear(screen.getByDisplayValue('Remarks / Notes'))
    await user.type(screen.getByLabelText('Label'), 'Press')
    await user.tab()

    await waitFor(() => expect(updateGigInfoBlock).toHaveBeenCalledWith(1, 5, {
      label: 'press',
      label_is_custom: false,
    }))
  })

  it('deletes a stored block after confirmation', async () => {
    const user = userEvent.setup()
    renderBlocks({
      blocks: [REMARKS, { id: 6, label: 'press', label_is_custom: false, content: '', position: 1 }],
    })
    await user.click(screen.getAllByRole('button', { name: /remove this block/i })[1])
    await user.click(await screen.findByRole('button', { name: /^delete$/i }))

    await waitFor(() => expect(deleteGigInfoBlock).toHaveBeenCalledWith(1, 6))
    await waitFor(() => expect(screen.queryByLabelText('Press')).not.toBeInTheDocument())
  })

  it('falls back to a fresh Remarks block when the last one is deleted', async () => {
    const user = userEvent.setup()
    renderBlocks({ blocks: [REMARKS] })
    await user.click(screen.getByRole('button', { name: /remove this block/i }))
    await user.click(await screen.findByRole('button', { name: /^delete$/i }))

    await waitFor(() => expect(deleteGigInfoBlock).toHaveBeenCalledWith(1, 5))
    await waitFor(() => expect(contentField('Remarks / Notes')).toHaveValue(''))
  })

  it('drops an untouched row it just added without asking', async () => {
    const user = userEvent.setup()
    renderBlocks({ blocks: [REMARKS] })
    await user.click(screen.getByRole('button', { name: /add info block/i }))
    expect(screen.getAllByLabelText('Label')).toHaveLength(2)

    await user.click(screen.getAllByRole('button', { name: /remove this block/i })[1])

    await waitFor(() => expect(screen.getAllByLabelText('Label')).toHaveLength(1))
    expect(deleteGigInfoBlock).not.toHaveBeenCalled()
  })

  it('gives a reader the text but no way to change it', () => {
    renderBlocks({ blocks: [REMARKS], editable: false })
    expect(contentField('Remarks / Notes')).toHaveAttribute('readonly')
    expect(screen.queryByLabelText('Label')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add info block/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /remove this block/i })).not.toBeInTheDocument()
  })

  it('surfaces a failed save', async () => {
    updateGigInfoBlock.mockRejectedValue(new Error('Network down'))
    const user = userEvent.setup()
    renderBlocks({ blocks: [REMARKS] })
    await user.type(contentField('Remarks / Notes'), '!')

    expect(await screen.findByText('Network down', undefined, SAVED)).toBeInTheDocument()
  })
})
