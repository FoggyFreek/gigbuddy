import { render, screen } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import theme from '../theme.ts'
import PendingApprovalPage from '../pages/PendingApprovalPage.tsx'

vi.mock('../contexts/authContext.ts', () => ({
  useAuth: vi.fn(),
}))

import { useAuth } from '../contexts/authContext.ts'

function renderPage() {
  return render(
    <ThemeProvider theme={theme}>
      <PendingApprovalPage />
    </ThemeProvider>,
  )
}

describe('PendingApprovalPage', () => {
  beforeEach(() => {
    useAuth.mockReturnValue({
      user: { status: 'pending' },
      logout: vi.fn(),
    })
  })

  it('uses the login screen branding and keeps the pending message', () => {
    renderPage()

    expect(screen.getByRole('img', { name: 'gigbuddy' })).toHaveAttribute(
      'src',
      '/icons/gigbuddy_logo1.png',
    )
    expect(screen.getByText('Access request received')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument()
    expect(screen.getByText(`© ${new Date().getFullYear()} gigbuddy`)).toBeInTheDocument()
  })

  it('keeps the rejected-state copy', () => {
    useAuth.mockReturnValue({
      user: { status: 'rejected' },
      logout: vi.fn(),
    })

    renderPage()

    expect(screen.getByText('Access denied')).toBeInTheDocument()
    expect(screen.getByText(/Your access request was not approved/)).toBeInTheDocument()
  })
})
