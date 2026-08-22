import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DialogProvider } from '../../../contexts/DialogContext.tsx'
import theme from '../../../theme.ts'
import VenuesTable from '../components/VenuesTable.tsx'
import {
  addVenueGroupMembers,
  deleteVenueGroup,
  listVenueGroups,
  removeVenueGroupMembers,
  renameVenueGroup,
} from '../venueGroups.ts'

const permissionState = vi.hoisted(() => ({ canWritePlanning: true }))

vi.mock('../../../hooks/useCompactLayout.ts', () => ({ useCompactLayout: () => false }))
vi.mock('../../../hooks/usePermissions.ts', () => ({
  usePermissions: () => ({ canWritePlanning: permissionState.canWritePlanning }),
}))
vi.mock('../venueGroups.ts', () => ({
  listVenueGroups: vi.fn(),
  createVenueGroup: vi.fn(),
  renameVenueGroup: vi.fn(),
  deleteVenueGroup: vi.fn(),
  addVenueGroupMembers: vi.fn(),
  removeVenueGroupMembers: vi.fn(),
}))

const GROUP = { id: 10, name: 'Tour group' }
const VENUES = [
  { id: 1, name: 'Alpha Hall', category: 'venue', group_ids: [10], email: 'alpha@example.com' },
  { id: 2, name: 'Beta Festival', category: 'festival', group_ids: [10] },
  { id: 3, name: 'Gamma Club', category: 'venue', group_ids: [] },
]

function wrap(props = {}) {
  return render(
    <MemoryRouter>
      <DialogProvider>
        <ThemeProvider theme={theme}>
          <VenuesTable venues={VENUES} onRowClick={vi.fn()} {...props} />
        </ThemeProvider>
      </DialogProvider>
    </MemoryRouter>,
  )
}

async function activateGroup(user) {
  await user.click(screen.getByRole('button', { name: 'Filter' }))
  await user.click(screen.getByRole('button', { name: 'Groups' }))
  await user.click(await screen.findByText('Tour group'))
  await user.keyboard('{Escape}')
}

describe('VenuesTable venue groups', () => {
  beforeEach(() => {
    permissionState.canWritePlanning = true
    vi.clearAllMocks()
    listVenueGroups.mockResolvedValue({ items: [GROUP], meta: { limit: 10, returned: 1 } })
    addVenueGroupMembers.mockResolvedValue({ added_count: 1, already_present_count: 0 })
    removeVenueGroupMembers.mockResolvedValue({ removed_count: 1 })
    renameVenueGroup.mockResolvedValue(GROUP)
    deleteVenueGroup.mockResolvedValue(undefined)
  })

  it('uses an exclusive group filter and reports it as one active filter', async () => {
    const user = userEvent.setup()
    wrap()

    await activateGroup(user)

    expect(screen.getByRole('button', { name: 'Filter (1)' })).toBeInTheDocument()
    expect(screen.getByText('Alpha Hall')).toBeInTheDocument()
    expect(screen.getByText('Beta Festival')).toBeInTheDocument()
    expect(screen.queryByText('Gamma Club')).not.toBeInTheDocument()
    expect(listVenueGroups).toHaveBeenCalledWith('', 10, expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })

  it('selects only group results remaining after the main search', async () => {
    const user = userEvent.setup()
    wrap()
    await activateGroup(user)

    await user.type(screen.getByPlaceholderText(/Search venues/), 'Alpha')
    await user.click(screen.getByRole('checkbox', {
      name: 'Select all visible venues and festivals in Tour group',
    }))

    expect(screen.getByText('1 venue selected')).toBeInTheDocument()
    expect(screen.queryByText('Beta Festival')).not.toBeInTheDocument()
  })

  it('adds selected venues to one existing group through the shared dialog', async () => {
    const user = userEvent.setup()
    const onMembershipsChanged = vi.fn()
    wrap({ onMembershipsChanged })

    const alphaRow = screen.getByText('Alpha Hall').closest('tr')
    await user.click(within(alphaRow).getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Add to group' }))

    const dialog = await screen.findByRole('dialog', { name: 'Add selected to group' })
    await user.click(await within(dialog).findByRole('radio', { name: 'Tour group' }))
    await user.click(within(dialog).getByRole('button', { name: 'Add to group' }))

    await waitFor(() => expect(addVenueGroupMembers).toHaveBeenCalledWith(10, [1]))
    expect(onMembershipsChanged).toHaveBeenCalledWith(10, [1], 'add')
  })

  it('removes selected visible results from the active group', async () => {
    const user = userEvent.setup()
    const onMembershipsChanged = vi.fn()
    wrap({ onMembershipsChanged })
    await activateGroup(user)
    await user.click(screen.getByRole('checkbox', {
      name: 'Select all visible venues and festivals in Tour group',
    }))
    await user.click(screen.getByRole('button', { name: 'Remove from group' }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove from group?' })
    await user.click(within(dialog).getByRole('button', { name: 'Remove from group' }))

    await waitFor(() => expect(removeVenueGroupMembers).toHaveBeenCalledWith(10, [1, 2]))
    expect(onMembershipsChanged).toHaveBeenCalledWith(10, [1, 2], 'remove')
  })

  it('keeps filtering available but hides group mutations from readers', async () => {
    permissionState.canWritePlanning = false
    const user = userEvent.setup()
    wrap()
    await activateGroup(user)
    await user.click(screen.getByRole('checkbox', {
      name: 'Select all visible venues and festivals in Tour group',
    }))

    expect(screen.getByRole('button', { name: 'Filter (1)' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add to group' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove from group' })).not.toBeInTheDocument()
  })

  it('renames an active group without dropping its filter', async () => {
    const user = userEvent.setup()
    renameVenueGroup.mockResolvedValue({ id: 10, name: 'Renamed tour' })
    wrap()
    await activateGroup(user)
    await user.click(screen.getByRole('button', { name: 'Filter (1)' }))
    await user.click(await screen.findByRole('button', { name: 'Rename group' }))

    const dialog = await screen.findByRole('dialog', { name: 'Rename group' })
    const input = within(dialog).getByRole('textbox', { name: 'Group name' })
    await user.clear(input)
    await user.type(input, 'Renamed tour')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(renameVenueGroup).toHaveBeenCalledWith(10, 'Renamed tour'))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Rename group' })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Filter (1)' })).toBeInTheDocument()
    expect(screen.getByText('Select all visible venues and festivals in Renamed tour')).toBeInTheDocument()
  })

  it('deletes an active group through the shared delete confirmation', async () => {
    const user = userEvent.setup()
    const onMembershipsChanged = vi.fn()
    wrap({ onMembershipsChanged })
    await activateGroup(user)
    await user.click(screen.getByRole('button', { name: 'Filter (1)' }))
    await user.click(await screen.findByRole('button', { name: 'Delete group' }))

    const dialog = await screen.findByRole('dialog', { name: 'Delete Tour group?' })
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(deleteVenueGroup).toHaveBeenCalledWith(10))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Delete Tour group?' })).not.toBeInTheDocument())
    expect(onMembershipsChanged).toHaveBeenCalledWith(10, null, 'delete')
    expect(screen.getByRole('button', { name: 'Filter' })).toBeInTheDocument()
  })
})
