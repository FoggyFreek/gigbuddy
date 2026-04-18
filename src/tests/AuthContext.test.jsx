import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import theme from '../theme.js'
import { AuthProvider } from '../contexts/AuthContext.jsx'
import { useAuth } from '../contexts/authContext.js'

vi.mock('../api/auth.js', () => ({
  getCurrentUser: vi.fn(),
  logout: vi.fn(),
}))

import { getCurrentUser, logout } from '../api/auth.js'

function TestConsumer() {
  const { user, logout: doLogout } = useAuth()
  if (user === undefined) return <div>loading</div>
  if (user === null) return <div>unauthenticated</div>
  return (
    <div>
      <div>hello {user.name}</div>
      <div>status: {user.status}</div>
      <button onClick={doLogout}>logout</button>
    </div>
  )
}

function wrap(ui) {
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter>
        {ui}
      </MemoryRouter>
    </ThemeProvider>,
  )
}

describe('AuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    logout.mockResolvedValue(null)
  })

  it('shows loading initially', () => {
    getCurrentUser.mockReturnValue(new Promise(() => {}))
    wrap(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    )
    expect(screen.getByText('loading')).toBeInTheDocument()
  })

  it('sets user to null on 401', async () => {
    const err = Object.assign(new Error('Unauthorized'), { status: 401 })
    getCurrentUser.mockRejectedValue(err)
    wrap(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByText('unauthenticated')).toBeInTheDocument())
  })

  it('populates user on successful fetch', async () => {
    getCurrentUser.mockResolvedValue({
      id: 1,
      name: 'Alice',
      email: 'alice@example.com',
      status: 'approved',
      isAdmin: false,
      pictureUrl: null,
      bandMemberId: null,
    })
    wrap(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByText('hello Alice')).toBeInTheDocument())
    expect(screen.getByText('status: approved')).toBeInTheDocument()
  })

  it('sets user to null after logout', async () => {
    getCurrentUser.mockResolvedValue({
      id: 1,
      name: 'Alice',
      email: 'alice@example.com',
      status: 'approved',
      isAdmin: false,
      pictureUrl: null,
      bandMemberId: null,
    })
    const user = userEvent.setup()
    wrap(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByText('hello Alice')).toBeInTheDocument())
    await user.click(screen.getByText('logout'))
    await waitFor(() => expect(screen.getByText('unauthenticated')).toBeInTheDocument())
    expect(logout).toHaveBeenCalled()
  })

  it('sets user to null on auth:unauthorized event', async () => {
    getCurrentUser.mockResolvedValue({
      id: 1,
      name: 'Alice',
      email: 'alice@example.com',
      status: 'approved',
      isAdmin: false,
      pictureUrl: null,
      bandMemberId: null,
    })
    wrap(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    )
    await waitFor(() => expect(screen.getByText('hello Alice')).toBeInTheDocument())
    window.dispatchEvent(new Event('auth:unauthorized'))
    await waitFor(() => expect(screen.getByText('unauthenticated')).toBeInTheDocument())
  })
})
