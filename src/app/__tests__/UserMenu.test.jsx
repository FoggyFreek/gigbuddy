import { render, screen } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import theme from '../../theme.ts'
import UserMenu from '../../components/appShell/UserMenu.tsx'

function wrap(ui) {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>{ui}</ThemeProvider>
    </MemoryRouter>,
  )
}

const BAND = { tenantId: 1, tenantName: 'Band A', kind: 'band', role: 'contributor' }
const OTHER_BAND = { tenantId: 2, tenantName: 'Band B', kind: 'band', role: 'member' }
const PERSONAL = { tenantId: 3, tenantName: 'Alpha User', kind: 'personal', role: 'tenant_admin' }

function open(props = {}) {
  return wrap(
    <UserMenu
      anchorEl={document.body}
      open
      onClose={vi.fn()}
      approvedMemberships={[]}
      onSwitch={vi.fn()}
      onLogout={vi.fn()}
      {...props}
    />,
  )
}

describe('UserMenu', () => {
  it('does not duplicate tenant management in the user menu', () => {
    open()
    expect(screen.queryByRole('menuitem', { name: /manage tenants/i })).not.toBeInTheDocument()
  })

  it('pins the personal workspace above the bands under its own header', () => {
    open({ approvedMemberships: [BAND, PERSONAL], activeTenantId: 1 })

    const items = screen.getAllByRole('menuitem').map((i) => i.textContent)
    expect(items[0]).toContain('Alpha User')
    expect(items[1]).toContain('Band A')
    expect(screen.getByText('Me')).toBeInTheDocument()
    expect(screen.getByText('Switch band')).toBeInTheDocument()
  })

  // A single band alongside a workspace is still two tenants: the band row must
  // stay reachable even though there is only one of them.
  it('lists the single band when a personal workspace exists', () => {
    const onSwitch = vi.fn()
    open({ approvedMemberships: [BAND, PERSONAL], activeTenantId: 3, onSwitch })
    screen.getByText('Band A').click()
    expect(onSwitch).toHaveBeenCalledWith(1)
  })

  it('offers the artist profile action only when the user has no personal workspace', () => {
    open({ approvedMemberships: [BAND, OTHER_BAND], onCreatePersonalWorkspace: vi.fn() })
    expect(screen.getByRole('menuitem', { name: /artist profile/i })).toBeInTheDocument()
  })

  it('does not offer the artist profile action for an existing personal workspace', () => {
    open({ approvedMemberships: [BAND, PERSONAL], onCreatePersonalWorkspace: vi.fn() })
    expect(screen.queryByRole('menuitem', { name: /artist profile/i })).not.toBeInTheDocument()
  })

  it('shows no switcher at all for a user with one tenant', () => {
    open({ approvedMemberships: [BAND] })
    expect(screen.queryByText('Switch band')).not.toBeInTheDocument()
    expect(screen.queryByText('Band A')).not.toBeInTheDocument()
  })
})
