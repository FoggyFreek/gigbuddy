import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it, vi } from 'vitest'
import { AuthContext } from '../contexts/authContext.ts'
import { getMyStorageStats } from '../api/statistics.ts'
import StorageUsageSection from '../components/settings/StorageUsageSection.tsx'
import theme from '../theme.ts'

vi.mock('../api/statistics.ts', () => ({
  getMyStorageStats: vi.fn().mockResolvedValue({ storage_bytes: 0, object_count: 0 }),
  refreshMyStorageStats: vi.fn(),
}))

// entitlements with a 100 MB storage cap; omit to leave the tenant unenforced.
const cappedEntitlements = {
  planSlug: 'free',
  locked: false,
  financeReadOnly: false,
  flags: {},
  limits: { storage_mb: 100, members: 5, bands: 1 },
}

function wrap(entitlements) {
  const user = { isSuperAdmin: false, activeTenantRole: 'tenant_admin', entitlements: entitlements ?? null }
  return render(
    <AuthContext.Provider value={{ user, logout: vi.fn() }}>
      <ThemeProvider theme={theme}>
        <MemoryRouter>
          <StorageUsageSection />
        </MemoryRouter>
      </ThemeProvider>
    </AuthContext.Provider>,
  )
}

describe('StorageUsageSection', () => {
  it('shows a progress bar and upgrade button when a storage limit is set', async () => {
    getMyStorageStats.mockResolvedValueOnce({ storage_bytes: 50 * 1024 * 1024, object_count: 3 })
    wrap(cappedEntitlements)
    const bar = await screen.findByRole('progressbar', { name: /storage/i })
    expect(bar).toHaveAttribute('aria-valuenow', '50')
    expect(screen.getByRole('button', { name: /upgrade storage/i })).toBeInTheDocument()
    expect(screen.getByText(/50\.0 MB of 100\.0 MB used/i)).toBeInTheDocument()
  })

  it('shows only the actual storage when no limit is set', async () => {
    getMyStorageStats.mockResolvedValueOnce({ storage_bytes: 50 * 1024 * 1024, object_count: 3 })
    wrap(null)
    await screen.findByText(/50\.0 MB/)
    expect(screen.queryByRole('progressbar', { name: /storage/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /upgrade storage/i })).not.toBeInTheDocument()
  })
})
