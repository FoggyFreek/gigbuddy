import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/rehearsals.js', () => ({
  listRehearsals: vi.fn().mockResolvedValue([
    {
      id: 1,
      proposed_date: '2099-05-10',
      start_time: '19:00:00',
      end_time: '22:00:00',
      location: 'Studio A',
      status: 'option',
      participants: [],
    },
  ]),
  getRehearsal: vi.fn().mockResolvedValue({
    id: 1,
    proposed_date: '2099-05-10',
    start_time: '19:00:00',
    end_time: '22:00:00',
    location: 'Studio A',
    notes: '',
    status: 'option',
    participants: [],
  }),
  createRehearsal: vi.fn(),
  updateRehearsal: vi.fn(),
  addParticipant: vi.fn(),
  removeParticipant: vi.fn(),
  setVote: vi.fn(),
}))
vi.mock('../api/bandMembers.js', () => ({
  listMembers: vi.fn().mockResolvedValue([]),
}))

import RehearsalsPage from '../pages/RehearsalsPage.jsx'
import RehearsalDetailPage from '../pages/RehearsalDetailPage.jsx'
import { listRehearsals } from '../api/rehearsals.js'
import theme from '../theme.js'

function wrap(ui, { initialEntries = ['/'] } = {}) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <ThemeProvider theme={theme}>
        <LocalizationProvider dateAdapter={AdapterDayjs}>{ui}</LocalizationProvider>
      </ThemeProvider>
    </MemoryRouter>
  )
}

function wrapWithRoutes({ initialEntries }) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <ThemeProvider theme={theme}>
        <LocalizationProvider dateAdapter={AdapterDayjs}>
          <Routes>
            <Route path="/rehearsals" element={<RehearsalsPage />}>
              <Route path=":id" element={<RehearsalDetailPage />} />
            </Route>
          </Routes>
        </LocalizationProvider>
      </ThemeProvider>
    </MemoryRouter>
  )
}

describe('RehearsalsPage', () => {
  beforeEach(() => {
    listRehearsals.mockClear()
  })

  it('renders header and Propose button', async () => {
    wrap(<RehearsalsPage />)
    expect(screen.getByRole('heading', { name: /rehearsals/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /propose rehearsal/i })).toBeInTheDocument()
    await waitFor(() => expect(listRehearsals).toHaveBeenCalled())
  })

  it('shows loaded rehearsals in the table', async () => {
    wrap(<RehearsalsPage />)
    await waitFor(() => expect(screen.getByText('Studio A')).toBeInTheDocument())
  })

  it('opens create modal when Propose clicked', async () => {
    const user = userEvent.setup()
    wrap(<RehearsalsPage />)
    await user.click(screen.getByRole('button', { name: /propose rehearsal/i }))
    expect(screen.getByText('Propose rehearsal', { selector: 'h2' })).toBeInTheDocument()
  })

  it('renders detail alongside the list at /rehearsals/:id and the Close button returns to /rehearsals', async () => {
    const user = userEvent.setup()
    wrapWithRoutes({ initialEntries: ['/rehearsals/1'] })

    await waitFor(() => expect(screen.getByText('Rehearsal details')).toBeInTheDocument())
    expect(screen.getByRole('heading', { name: /rehearsals/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^back$/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^close$/i }))

    await waitFor(() => expect(screen.queryByText('Rehearsal details')).not.toBeInTheDocument())
    expect(screen.getByRole('heading', { name: /rehearsals/i })).toBeInTheDocument()
  })
})
