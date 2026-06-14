import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/rehearsals.ts', () => ({
  getRehearsal: vi.fn(),
  updateRehearsal: vi.fn(),
  deleteRehearsal: vi.fn(),
  addParticipant: vi.fn(),
  removeParticipant: vi.fn(),
  setVote: vi.fn(),
  addSong: vi.fn(),
  removeSong: vi.fn(),
}))
vi.mock('../api/bandMembers.ts', () => ({
  listMembers: vi.fn().mockResolvedValue([]),
}))
vi.mock('../api/songs.ts', () => ({
  searchSongs: vi.fn(),
}))

import RehearsalDetailPage from '../pages/RehearsalDetailPage.tsx'
import { addSong, getRehearsal, removeSong } from '../api/rehearsals.ts'
import { searchSongs } from '../api/songs.ts'
import theme from '../theme.ts'

const baseRehearsal = {
  id: 1,
  proposed_date: '2099-05-10',
  start_time: '19:00:00',
  end_time: '22:00:00',
  location: 'Studio A',
  notes: '',
  status: 'option',
  participants: [],
  songs: [{ song_id: 7, title: 'Wonderwall', artist: 'Oasis' }],
}

function wrap() {
  return render(
    <MemoryRouter initialEntries={['/rehearsals/1']}>
      <ThemeProvider theme={theme}>
        <LocalizationProvider dateAdapter={AdapterDayjs}>
          <Routes>
            <Route path="/rehearsals/:id" element={<RehearsalDetailPage />} />
          </Routes>
        </LocalizationProvider>
      </ThemeProvider>
    </MemoryRouter>
  )
}

describe('Rehearsal songs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getRehearsal.mockResolvedValue(baseRehearsal)
    searchSongs.mockResolvedValue([])
  })

  it('shows linked songs as cards with title, artist and a link to the song', async () => {
    wrap()
    await waitFor(() => expect(screen.getByText('Wonderwall')).toBeInTheDocument())
    expect(screen.getByText('Oasis')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open wonderwall/i })).toHaveAttribute('href', '/songs/7')
  })

  it('detaches a song from its card', async () => {
    removeSong.mockResolvedValue(undefined)
    const user = userEvent.setup()
    wrap()
    await waitFor(() => expect(screen.getByText('Wonderwall')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /detach wonderwall/i }))
    await waitFor(() => expect(removeSong).toHaveBeenCalledWith(1, 7))
    expect(screen.queryByText('Wonderwall')).not.toBeInTheDocument()
  })

  it('does not search under 3 characters', async () => {
    const user = userEvent.setup()
    wrap()
    await waitFor(() => expect(screen.getByLabelText('Add song')).toBeInTheDocument())
    await user.type(screen.getByLabelText('Add song'), 'wo')
    await new Promise((r) => setTimeout(r, 400))
    expect(searchSongs).not.toHaveBeenCalled()
  })

  it('searches after 3 characters and links the chosen song', async () => {
    searchSongs.mockResolvedValue([{ id: 9, title: 'Wonderful Tonight', artist: 'Eric Clapton' }])
    addSong.mockResolvedValue({
      ...baseRehearsal,
      songs: [
        ...baseRehearsal.songs,
        { song_id: 9, title: 'Wonderful Tonight', artist: 'Eric Clapton' },
      ],
    })
    const user = userEvent.setup()
    wrap()
    await waitFor(() => expect(screen.getByLabelText('Add song')).toBeInTheDocument())
    await user.type(screen.getByLabelText('Add song'), 'wonderf')
    await waitFor(() => expect(searchSongs).toHaveBeenCalledWith('wonderf'))
    const option = await screen.findByText('Wonderful Tonight', { selector: 'li *, li' })
    await user.click(option)
    await waitFor(() => expect(addSong).toHaveBeenCalledWith(1, 9))
    expect(await screen.findByText('Eric Clapton')).toBeInTheDocument()
  })
})
