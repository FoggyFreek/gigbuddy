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
})
