import { render, screen } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import AdminMenu from '../../components/appShell/AdminMenu.tsx'
import theme from '../../theme.ts'

describe('AdminMenu', () => {
  it('links every super-admin surface from one menu', () => {
    render(
      <MemoryRouter>
        <ThemeProvider theme={theme}>
          <AdminMenu anchorEl={document.body} open onClose={vi.fn()} />
        </ThemeProvider>
      </MemoryRouter>,
    )

    const expected = {
      'Operations dashboard': '/admin/operations',
      'Billing operations': '/admin/operations/billing',
      'Webhook failures': '/admin/operations/webhooks',
      'Status drift': '/admin/operations/status',
      'Organisations': '/admin/tenants',
      'All users': '/admin/users',
      'Band profiles (claims)': '/admin/band-profile-claims',
      'Plan catalog': '/admin/plan-catalog',
      'Pricing rules': '/admin/pricing-rules',
      'Complimentary access': '/admin/complimentary-access',
    }
    for (const [name, href] of Object.entries(expected)) {
      expect(screen.getByRole('menuitem', { name })).toHaveAttribute('href', href)
    }
  })
})
