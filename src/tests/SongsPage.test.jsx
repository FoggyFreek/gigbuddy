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
  uploadSongCover: vi.fn().mockResolvedValue({ cover_image_path: 'tenants/1/song_covers/new.webp' }),
  deleteSongCover: vi.fn().mockResolvedValue(undefined),
}))

import SongsPage from '../pages/SongsPage.tsx'
import SongDetailPage from '../pages/SongDetailPage.tsx'
import {
  deleteSong,
  deleteSongCover,
  getSong,
  listSongs,
  setSongTags,
  updateSong,
  uploadSongCover,
} from '../api/songs.ts'
import theme from '../theme.ts'
import { AuthContext } from '../contexts/authContext.ts'

// Render as a writer (super admin grants every planning.write capability) so the
// create/edit/delete affordances gated on canWritePlanning are present.
const writerAuth = { user: { isSuperAdmin: true } }

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

function wrapWithRoutes({ initialEntries, auth = writerAuth }) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <ThemeProvider theme={theme}>
        <AuthContext.Provider value={auth}>
          <Routes>
            <Route path="/songs" element={<SongsPage />}>
              <Route path=":id" element={<SongDetailPage />} />
            </Route>
          </Routes>
        </AuthContext.Provider>
      </ThemeProvider>
    </MemoryRouter>,
  )
}

// A plan that locks every feature — the chords/documents/recordings sections
// should carry premium diamonds pointing at their upsell pages.
const lockedEntitlements = {
  planSlug: 'free',
  subscriptionStatus: null,
  locked: false,
  financeReadOnly: false,
  flags: {
    finance: false,
    integrations: false,
    customization: false,
    song_files: false,
    chordpro: false,
    public_promotion: false,
  },
  limits: { storage_mb: 100, members: 5, bands: 1 },
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

  it('uses the song title as the detail heading', async () => {
    wrapWithRoutes({ initialEntries: ['/songs/1'] })

    expect(await screen.findByRole('heading', { name: 'Creep' })).toBeInTheDocument()
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

  it('marks gated sections with diamonds when the plan lacks them', async () => {
    wrapWithRoutes({
      initialEntries: ['/songs/1'],
      auth: { user: { ...writerAuth.user, entitlements: lockedEntitlements } },
    })

    await waitFor(() => expect(screen.getByDisplayValue('Creep')).toBeInTheDocument())

    // Chords section heading + the cover camera badge both carry diamonds.
    const diamonds = screen.getAllByRole('link', { name: /premium feature/i })
    expect(diamonds).toHaveLength(2)
    const hrefs = diamonds.map((d) => d.getAttribute('href'))
    expect(hrefs).toContain('/upgrade/chordpro')
    expect(hrefs).toContain('/upgrade/customization')

    // Documents/recordings: the add buttons become diamond links to the upsell.
    const addPdf = screen.getByRole('link', { name: /add pdf/i })
    expect(addPdf).toHaveAttribute('href', '/upgrade/song_files')
    expect(within(addPdf).getByTestId('DiamondOutlinedIcon')).toBeInTheDocument()
    const addMp3 = screen.getByRole('link', { name: /add mp3/i })
    expect(addMp3).toHaveAttribute('href', '/upgrade/song_files')
    expect(within(addMp3).getByTestId('DiamondOutlinedIcon')).toBeInTheDocument()
  })

  it('shows no premium diamonds when entitlements are unenforced', async () => {
    wrapWithRoutes({ initialEntries: ['/songs/1'] })

    await waitFor(() => expect(screen.getByDisplayValue('Creep')).toBeInTheDocument())
    expect(screen.queryByRole('link', { name: /premium feature/i })).not.toBeInTheDocument()
    // The add buttons stay real upload buttons with the attachment icon.
    const addPdf = screen.getByRole('button', { name: /add pdf/i })
    expect(within(addPdf).getByTestId('AttachFileIcon')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add mp3/i })).toBeInTheDocument()
  })

  it('shows the album placeholder when no cover is set and uploads one via the camera button', async () => {
    const user = userEvent.setup()
    const { container } = wrapWithRoutes({ initialEntries: ['/songs/1'] })

    await waitFor(() => expect(screen.getByDisplayValue('Creep')).toBeInTheDocument())
    expect(screen.getAllByTestId('AlbumIcon').length).toBeGreaterThan(0)

    const file = new File(['x'], 'cover.png', { type: 'image/png' })
    const input = container.querySelector('input[type="file"][accept*="webp"]')
    await user.upload(input, file)

    await waitFor(() => expect(uploadSongCover).toHaveBeenCalledWith(1, file))
    expect(
      container.querySelector('img[src="/api/files/tenants/1/song_covers/new.webp"]'),
    ).not.toBeNull()
  })

  it('shows the cover in the list row and removes it via the camera menu', async () => {
    const withCover = { ...SONG, cover_image_path: 'tenants/1/song_covers/x.webp' }
    listSongs.mockResolvedValue([withCover])
    getSong.mockResolvedValue(withCover)
    const user = userEvent.setup()
    const { container } = wrapWithRoutes({ initialEntries: ['/songs/1'] })

    await waitFor(() => expect(screen.getByDisplayValue('Creep')).toBeInTheDocument())
    expect(
      container.querySelectorAll('img[src="/api/files/tenants/1/song_covers/x.webp"]').length,
    ).toBeGreaterThanOrEqual(2) // list row + detail header

    await user.click(screen.getByRole('button', { name: /change or remove cover image/i }))
    await user.click(screen.getByRole('menuitem', { name: /remove cover/i }))

    await waitFor(() => expect(deleteSongCover).toHaveBeenCalledWith(1))
  })

  it('falls back to the album placeholder when the plan lacks customization', async () => {
    const withCover = { ...SONG, cover_image_path: 'tenants/1/song_covers/x.webp' }
    listSongs.mockResolvedValue([withCover])
    getSong.mockResolvedValue(withCover)
    const { container } = wrapWithRoutes({
      initialEntries: ['/songs/1'],
      auth: { user: { ...writerAuth.user, entitlements: lockedEntitlements } },
    })

    await waitFor(() => expect(screen.getByDisplayValue('Creep')).toBeInTheDocument())
    // Stored cover is not shown; the outlined album placeholder is.
    expect(container.querySelector('img[src*="song_covers"]')).toBeNull()
    expect(screen.getAllByTestId('AlbumIcon').length).toBeGreaterThan(0)
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
