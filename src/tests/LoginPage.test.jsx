import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import LoginPage from '../pages/LoginPage.tsx'

function renderPage(route = '/login') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <LoginPage />
    </MemoryRouter>,
  )
}

describe('LoginPage', () => {
  it('renders a sign-in button per provider', () => {
    renderPage()

    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in with Microsoft' })).toBeInTheDocument()
  })

  it('shows no auth error by default', () => {
    renderPage()

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('explains the account-exists rejection from the callback redirect', () => {
    renderPage('/login?authError=account_exists')

    expect(screen.getByRole('alert')).toHaveTextContent(
      'An account with this email already exists. Sign in with your original provider, then link this sign-in method under Settings → Connected accounts.',
    )
  })
})
