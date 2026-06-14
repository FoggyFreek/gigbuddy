import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/songs.ts', () => ({
  listSongs: vi.fn(),
  getSong: vi.fn(),
  createSong: vi.fn(),
  updateSong: vi.fn().mockResolvedValue({}),
  deleteSong: vi.fn().mockResolvedValue({}),
  importSongs: vi.fn(),
  searchSongTags: vi.fn().mockResolvedValue([]),
  setSongTags: vi.fn(),
  addSongLink: vi.fn(),
  updateSongLink: vi.fn(),
  deleteSongLink: vi.fn().mockResolvedValue({}),
  uploadSongDocument: vi.fn(),
  deleteSongDocument: vi.fn().mockResolvedValue({}),
  uploadSongRecording: vi.fn(),
  deleteSongRecording: vi.fn().mockResolvedValue({}),
}))

import SongsPage from '../pages/SongsPage.tsx'
import SongDetailPage from '../pages/SongDetailPage.tsx'
import {
  deleteSong,
  getSong,
  listSongs,
  setSongTags,
  updateSong,
} from '../api/songs.ts'
import theme from '../theme.ts'

const SONG = {
  id: 1,
  title: 'Creep',
  artist: '',
  song_key: 'G',
  tempo: 92,
  duration_seconds: 238,
  lyrics_html: '<p>But I am a creep</p>',
  notes: '',
  tags: [],
  links: [],
  documents: [],
  recordings: [],
}

const SONG_2 = {
  ...SONG,
  id: 2,
  title: 'Karma Police',
  lyrics_html: '<p>This is what you get</p>',
}

function wrapWithRoutes({ initialEntries }) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <ThemeProvider theme={theme}>
        <Routes>
          <Route path="/songs" element={<SongsPage />}>
            <Route path=":id" element={<SongDetailPage />} />
          </Route>
        </Routes>
      </ThemeProvider>
    </MemoryRouter>,
  )
}

describe('SongsPage — split-view detail', () => {
  beforeEach(() => {
    listSongs.mockReset()
    listSongs.mockResolvedValue([SONG])
    getSong.mockReset()
    getSong.mockResolvedValue(SONG)
    updateSong.mockClear()
    deleteSong.mockClear()
    setSongTags.mockReset()
    setSongTags.mockResolvedValue([])
  })

  it('autosaves the artist field and reflects it in the list row', async () => {
    const user = userEvent.setup()
    wrapWithRoutes({ initialEntries: ['/songs/1'] })

    await waitFor(() => expect(screen.getByDisplayValue('Creep')).toBeInTheDocument())

    await user.type(screen.getByLabelText('Artist'), 'Radiohead')

    await waitFor(
      () => expect(updateSong).toHaveBeenCalledWith(1, { artist: 'Radiohead' }),
      { timeout: 2000 },
    )
    expect(await screen.findAllByText(/Radiohead/)).not.toHaveLength(0)
    expect(listSongs).toHaveBeenCalledTimes(1) // no full reload
  })

  it('adds a free-solo tag and calls setSongTags', async () => {
    setSongTags.mockResolvedValue([{ id: 5, name: 'Jazz' }])
    const user = userEvent.setup()
    wrapWithRoutes({ initialEntries: ['/songs/1'] })

    await waitFor(() => expect(screen.getByDisplayValue('Creep')).toBeInTheDocument())

    await user.type(screen.getByLabelText('Tags'), 'Jazz{Enter}')

    await waitFor(() => expect(setSongTags).toHaveBeenCalledWith(1, ['Jazz']))
  })

  it('reloads lyrics when navigating between songs in the split view', async () => {
    listSongs.mockResolvedValue([SONG, SONG_2])
    getSong.mockImplementation((id) => Promise.resolve(id === 2 ? SONG_2 : SONG))
    const user = userEvent.setup()
    wrapWithRoutes({ initialEntries: ['/songs/1'] })

    await waitFor(() => expect(screen.getByDisplayValue('Creep')).toBeInTheDocument())
    expect(screen.getByText('But I am a creep')).toBeInTheDocument()

    await user.click(screen.getByText('Karma Police'))

    await waitFor(() => expect(screen.getByDisplayValue('Karma Police')).toBeInTheDocument())
    expect(screen.getByText('This is what you get')).toBeInTheDocument()
    expect(screen.queryByText('But I am a creep')).not.toBeInTheDocument()
  })

  it('removes a song from the list after deleting it in detail', async () => {
    const user = userEvent.setup()
    wrapWithRoutes({ initialEntries: ['/songs/1'] })

    await waitFor(() => expect(screen.getByDisplayValue('Creep')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /^delete$/i }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^delete$/i }))

    await waitFor(() => expect(deleteSong).toHaveBeenCalledWith(1))
    expect(screen.getByText(/no songs yet/i)).toBeInTheDocument()
  })
})
