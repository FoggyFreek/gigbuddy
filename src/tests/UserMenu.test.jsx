import { render, screen } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import theme from '../theme.ts'
import UserMenu from '../components/appShell/UserMenu.tsx'

function wrap(ui) {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>{ui}</ThemeProvider>
    </MemoryRouter>,
  )
}

describe('UserMenu', () => {
  it('does not duplicate tenant management in the user menu', () => {
    wrap(
      <UserMenu
        anchorEl={document.body}
        open
        onClose={vi.fn()}
        approvedMemberships={[]}
        onSwitch={vi.fn()}
        onLogout={vi.fn()}
      />,
    )
    expect(screen.queryByRole('menuitem', { name: /manage tenants/i })).not.toBeInTheDocument()
  })

  it('links to the settings page', () => {
    wrap(
      <UserMenu
        anchorEl={document.body}
        open
        onClose={vi.fn()}
        approvedMemberships={[]}
        onSwitch={vi.fn()}
        onLogout={vi.fn()}
      />,
    )
    const link = screen.getByRole('menuitem', { name: /^settings$/i })
    expect(link).toHaveAttribute('href', '/settings')
  })

  it('closes the menu when the settings link is clicked', () => {
    const onClose = vi.fn()
    wrap(
      <UserMenu
        anchorEl={document.body}
        open
        onClose={onClose}
        approvedMemberships={[]}
        onSwitch={vi.fn()}
        onLogout={vi.fn()}
      />,
    )
    screen.getByRole('menuitem', { name: /^settings$/i }).click()
    expect(onClose).toHaveBeenCalled()
  })
})
