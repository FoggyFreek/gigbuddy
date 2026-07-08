import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TenantsPage from '../pages/admin/TenantsPage.tsx'
import {
  deleteTenant,
  getTenantOnboardingStatus,
  listTenants,
  updateTenant,
  updateTenantOnboardingStatus,
} from '../api/tenants.ts'
import { listAllUsers } from '../api/adminUsers.ts'
import theme from '../theme.ts'

vi.mock('../api/tenants.ts', () => ({
  listTenants: vi.fn(),
  createTenant: vi.fn(),
  updateTenant: vi.fn(),
  archiveTenant: vi.fn(),
  unarchiveTenant: vi.fn(),
  grantMembership: vi.fn(),
  deleteTenant: vi.fn(),
  getTenantOnboardingStatus: vi.fn(),
  updateTenantOnboardingStatus: vi.fn(),
}))
vi.mock('../api/adminUsers.ts', () => ({ listAllUsers: vi.fn() }))
vi.mock('../api/statistics.ts', () => ({
  getAllStorageStats: vi.fn().mockResolvedValue([]),
  refreshAllStorageStats: vi.fn(),
}))
vi.mock('../contexts/authContext.ts', () => ({
  useAuth: () => ({ user: { activeTenantId: 1 }, switchTenant: vi.fn() }),
}))

const tenants = [
  { id: 1, slug: 'active-band', band_name: 'Active Band', archived_at: null, member_count: 2, owner_user_id: 10 },
  { id: 2, slug: 'old-band', band_name: 'Old Band', archived_at: '2026-07-01T00:00:00Z', member_count: 1, owner_user_id: null },
]

const users = [
  { id: 10, name: 'Owner Olly', email: 'olly@test.local', memberships: [{ tenant_id: 1, role: 'tenant_admin', status: 'approved' }] },
  { id: 11, name: 'Member Mia', email: 'mia@test.local', memberships: [{ tenant_id: 1, role: 'member', status: 'approved' }] },
  { id: 12, name: 'Pending Pete', email: 'pete@test.local', memberships: [{ tenant_id: 1, role: 'member', status: 'pending' }] },
  { id: 13, name: 'Beta Bob', email: 'bob@test.local', memberships: [{ tenant_id: 2, role: 'member', status: 'approved' }] },
]

function wrap() {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}><TenantsPage /></ThemeProvider>
    </MemoryRouter>,
  )
}

describe('TenantsPage owner assignment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listTenants.mockResolvedValue(tenants)
    listAllUsers.mockResolvedValue(users)
    getTenantOnboardingStatus.mockResolvedValue({ tenantOnboardingEnabled: true })
    updateTenant.mockResolvedValue({})
  })

  it('shows the current owner, or Unassigned when there is none', async () => {
    wrap()
    await screen.findAllByText('Active Band')
    expect(screen.getAllByText('Owner Olly').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Unassigned').length).toBeGreaterThan(0)
  })

  it('offers only the tenant\'s approved members plus "No owner" and saves the choice', async () => {
    const user = userEvent.setup()
    wrap()
    await screen.findAllByText('Old Band')
    await user.click(screen.getAllByRole('button', { name: 'assign owner for Old Band' })[0])

    await user.click(screen.getByRole('combobox', { name: 'Owner' }))
    const listbox = await screen.findByRole('listbox')
    // Only Old Band's approved member + the "No owner" option.
    expect(within(listbox).getByText(/Beta Bob/)).toBeInTheDocument()
    expect(within(listbox).queryByText(/Owner Olly/)).not.toBeInTheDocument()
    expect(within(listbox).queryByText(/Pending Pete/)).not.toBeInTheDocument()
    expect(within(listbox).getByText(/No owner/)).toBeInTheDocument()

    await user.click(within(listbox).getByText(/Beta Bob/))
    await user.click(screen.getByRole('button', { name: 'Assign' }))
    await waitFor(() => expect(updateTenant).toHaveBeenCalledWith(2, { owner_user_id: 13 }))
    await waitFor(() => expect(listTenants).toHaveBeenCalledTimes(2))
  })

  it('detaches the owner with the "No owner" option', async () => {
    const user = userEvent.setup()
    wrap()
    await screen.findAllByText('Active Band')
    await user.click(screen.getAllByRole('button', { name: 'assign owner for Active Band' })[0])

    await user.click(screen.getByRole('combobox', { name: 'Owner' }))
    await user.click(within(await screen.findByRole('listbox')).getByText(/No owner/))
    await user.click(screen.getByRole('button', { name: 'Assign' }))
    await waitFor(() => expect(updateTenant).toHaveBeenCalledWith(1, { owner_user_id: null }))
  })
})

describe('TenantsPage permanent deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listTenants.mockResolvedValue(tenants)
    listAllUsers.mockResolvedValue(users)
    getTenantOnboardingStatus.mockResolvedValue({ tenantOnboardingEnabled: true })
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

describe('TenantsPage tenant onboarding setting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listTenants.mockResolvedValue(tenants)
    listAllUsers.mockResolvedValue(users)
    getTenantOnboardingStatus.mockResolvedValue({ tenantOnboardingEnabled: true })
    updateTenantOnboardingStatus.mockResolvedValue({ tenantOnboardingEnabled: false })
  })

  it('loads and updates the onboarding toggle', async () => {
    const user = userEvent.setup()
    wrap()

    const toggle = await screen.findByRole('switch', { name: /allow onboarding/i })
    expect(toggle).toBeChecked()

    await user.click(toggle)

    await waitFor(() => expect(updateTenantOnboardingStatus).toHaveBeenCalledWith(false))
    expect(toggle).not.toBeChecked()
  })
})
