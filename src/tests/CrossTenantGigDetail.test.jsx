import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CrossTenantGigDetail from '../components/CrossTenantGigDetail.tsx'
import { AuthContext } from '../contexts/authContext.ts'
import { getBannerPath } from '../api/profile.ts'
import { setMyTaskDone } from '../api/me.ts'
import theme from '../theme.ts'

vi.mock('../api/profile.ts', () => ({ getBannerPath: vi.fn() }))
vi.mock('../api/me.ts', () => ({ setMyTaskDone: vi.fn() }))

const gig = {
  id: 7,
  tenantId: 9,
  tenantName: 'Other Band',
  tenantAvatarPath: null,
  event_date: '2026-08-12',
  event_description: 'Festival set',
  banner_path: 'tenants/9/gigs/source-secret.png',
  viewerBandMemberId: 22,
  tasks: [{ id: 5, title: 'Bring charts', assigned_to: 22, done: false }],
  attachments: [{ id: 6, original_filename: 'rider.pdf', file_size: 10 }],
}

function wrap() {
  const switchTenant = vi.fn().mockResolvedValue({})
  render(
    <ThemeProvider theme={theme}>
      <AuthContext.Provider value={{ user: { activeTenantId: 1 }, switchTenant }}>
        <CrossTenantGigDetail gig={gig} />
      </AuthContext.Provider>
    </ThemeProvider>,
  )
  return switchTenant
}

beforeEach(() => {
  vi.clearAllMocks()
  getBannerPath.mockResolvedValue('tenants/1/profile/artist-banner.png')
  setMyTaskDone.mockImplementation(async (id, done) => ({ ...gig.tasks[0], id, done }))
})

describe('CrossTenantGigDetail', () => {
  it('shows only Event and Tasks with the artist banner and plain attachments', async () => {
    wrap()
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Event', 'Tasks'])
    expect(screen.queryByRole('tab', { name: 'Terms' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Availability' })).not.toBeInTheDocument()
    expect(screen.getByText('rider.pdf')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'rider.pdf' })).not.toBeInTheDocument()

    const hero = screen.getByTestId('artist-only-gig-hero')
    await waitFor(() => expect(hero).toHaveStyle({
      backgroundImage: 'url(/api/files/tenants/1/profile/artist-banner.png)',
    }))
    expect(window.getComputedStyle(hero).backgroundImage).not.toContain('source-secret.png')
  })

  it('completes only the assigned task through /api/me and explicitly switches bands', async () => {
    const user = userEvent.setup()
    const switchTenant = wrap()
    await user.click(screen.getByRole('tab', { name: 'Tasks' }))
    await user.click(screen.getByRole('checkbox'))
    await waitFor(() => expect(setMyTaskDone).toHaveBeenCalledWith(5, true))

    await user.click(screen.getByRole('button', { name: 'Switch to band' }))
    expect(switchTenant).toHaveBeenCalledWith(9)
  })
})
