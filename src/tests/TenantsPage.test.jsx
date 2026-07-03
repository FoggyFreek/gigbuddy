import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TenantsPage from '../pages/admin/TenantsPage.tsx'
import { deleteTenant, listTenants } from '../api/tenants.ts'
import theme from '../theme.ts'

vi.mock('../api/tenants.ts', () => ({
  listTenants: vi.fn(),
  createTenant: vi.fn(),
  archiveTenant: vi.fn(),
  unarchiveTenant: vi.fn(),
  grantMembership: vi.fn(),
  deleteTenant: vi.fn(),
}))
vi.mock('../api/adminUsers.ts', () => ({ listAllUsers: vi.fn().mockResolvedValue([]) }))
vi.mock('../api/statistics.ts', () => ({
  getAllStorageStats: vi.fn().mockResolvedValue([]),
  refreshAllStorageStats: vi.fn(),
}))
vi.mock('../contexts/authContext.ts', () => ({
  useAuth: () => ({ user: { activeTenantId: 1 }, switchTenant: vi.fn() }),
}))

const tenants = [
  { id: 1, slug: 'active-band', band_name: 'Active Band', archived_at: null, member_count: 2 },
  { id: 2, slug: 'old-band', band_name: 'Old Band', archived_at: '2026-07-01T00:00:00Z', member_count: 1 },
]

function wrap() {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}><TenantsPage /></ThemeProvider>
    </MemoryRouter>,
  )
}

describe('TenantsPage permanent deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listTenants.mockResolvedValue(tenants)
    deleteTenant.mockResolvedValue(undefined)
  })

  it('only enables permanent deletion for archived tenants', async () => {
    wrap()
    await screen.findAllByText('Old Band')
    const activeDeletes = screen.getAllByRole('button', { name: 'permanently delete Active Band' })
    const archivedDeletes = screen.getAllByRole('button', { name: 'permanently delete Old Band' })
    expect(activeDeletes.every((button) => button.disabled)).toBe(true)
    expect(archivedDeletes.every((button) => !button.disabled)).toBe(true)
  })

  it('requires the exact slug and refreshes after successful deletion', async () => {
    const user = userEvent.setup()
    wrap()
    await screen.findAllByText('Old Band')
    await user.click(screen.getAllByRole('button', { name: 'permanently delete Old Band' })[0])
    expect(screen.getByRole('dialog')).toHaveTextContent('permanently deletes all PostgreSQL and RustFS data')
    const confirm = screen.getByLabelText('Type old-band to confirm')
    const deleteButton = screen.getByRole('button', { name: 'Delete permanently' })
    expect(deleteButton).toBeDisabled()
    await user.type(confirm, 'OLD-BAND')
    expect(deleteButton).toBeDisabled()
    await user.clear(confirm)
    await user.type(confirm, 'old-band')
    await user.click(deleteButton)
    await waitFor(() => expect(deleteTenant).toHaveBeenCalledWith(2, 'old-band'))
    await waitFor(() => expect(listTenants).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('keeps the dialog open and shows an API failure', async () => {
    deleteTenant.mockRejectedValueOnce(new Error('Failed to delete tenant storage'))
    const user = userEvent.setup()
    wrap()
    await screen.findAllByText('Old Band')
    await user.click(screen.getAllByRole('button', { name: 'permanently delete Old Band' })[0])
    await user.type(screen.getByLabelText('Type old-band to confirm'), 'old-band')
    await user.click(screen.getByRole('button', { name: 'Delete permanently' }))
    expect(await screen.findByText('Failed to delete tenant storage')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
