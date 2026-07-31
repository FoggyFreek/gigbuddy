import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StorageMigrationDialog from '../components/admin/StorageMigrationDialog.tsx'
import {
  deleteRustfsMigrationCopies,
  getStorageMigration,
  inventoryStorageMigration,
} from '../api/storageMigrations.ts'
import theme from '../theme.ts'

vi.mock('../api/storageMigrations.ts', () => ({
  getStorageMigration: vi.fn(),
  inventoryStorageMigration: vi.fn(),
  copyStorageMigration: vi.fn(),
  validateStorageMigration: vi.fn(),
  deleteRustfsMigrationCopies: vi.fn(),
}))

const tenant = { id: 7, slug: 'alpha', band_name: 'Alpha Band' }
const status = {
  tenant_id: 7,
  slug: 'alpha',
  band_name: 'Alpha Band',
  state: 'verified',
  source_object_count: 2,
  source_bytes: 42,
  copied_object_count: 2,
  copied_bytes: 42,
  database_references_checked: 2,
  missing_object_count: 0,
  mismatch_count: 0,
  validated_at: '2026-07-31T12:00:00Z',
}

function renderDialog() {
  return render(
    <ThemeProvider theme={theme}>
      <StorageMigrationDialog
        open
        tenant={tenant}
        initialStatus={status}
        onClose={vi.fn()}
        onStatusChange={vi.fn()}
      />
    </ThemeProvider>,
  )
}

describe('StorageMigrationDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getStorageMigration.mockResolvedValue(status)
    inventoryStorageMigration.mockResolvedValue({ ...status, state: 'inventorying' })
    deleteRustfsMigrationCopies.mockResolvedValue({ ...status, state: 'deleting_source' })
  })

  it('shows persisted migration progress and all four explicit stages', async () => {
    renderDialog()
    expect(await screen.findByText('verified')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '1. Inventory' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '2. Copy to Backblaze' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '3. Validate copy' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '4. Delete tenant copies from RustFS' })).toBeEnabled()
  })

  it('requires both exact confirmations before deleting RustFS copies', async () => {
    const user = userEvent.setup()
    renderDialog()
    await screen.findByText('verified')
    await user.click(screen.getByRole('button', { name: '4. Delete tenant copies from RustFS' }))
    const dialog = screen.getByRole('dialog')
    const remove = within(dialog).getByRole('button', { name: 'Delete RustFS copies' })
    expect(remove).toBeDisabled()
    await user.type(screen.getByLabelText('Type alpha to confirm'), 'alpha')
    await user.type(screen.getByLabelText('Type DELETE RUSTFS COPIES'), 'DELETE RUSTFS COPIES')
    await user.click(remove)
    await waitFor(() => expect(deleteRustfsMigrationCopies).toHaveBeenCalledWith(
      7, 'alpha', 'DELETE RUSTFS COPIES',
    ))
  })
})
