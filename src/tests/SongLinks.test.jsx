import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/songs.ts', () => ({
  addSongLink: vi.fn(),
  deleteSongLink: vi.fn(),
}))

import SongLinks from '../components/SongLinks.tsx'
import { matchPlatform } from '../utils/songLinkPlatforms.ts'
import { addSongLink, deleteSongLink } from '../api/songs.ts'
import theme from '../theme.ts'

const SPOTIFY_LINK = { id: 1, label: 'Spotify', url: 'https://open.spotify.com/track/abc123' }
const OTHER_LINK = { id: 2, label: 'Band wiki', url: 'https://example.com/wiki' }

function wrap(props = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <SongLinks songId={7} {...props} />
    </ThemeProvider>,
  )
}

describe('matchPlatform', () => {
  it('classifies URLs by platform prefix', () => {
    expect(matchPlatform('https://open.spotify.com/track/x')?.key).toBe('spotify')
    expect(matchPlatform('https://soundcloud.com/artist/track')?.key).toBe('soundcloud')
    expect(matchPlatform('https://music.apple.com/nl/album/x')?.key).toBe('apple_music')
    expect(matchPlatform('https://www.deezer.com/track/1')?.key).toBe('deezer')
    expect(matchPlatform('https://deezer.com/track/1')?.key).toBe('deezer')
    expect(matchPlatform('https://listen.tidal.com/track/1')?.key).toBe('tidal')
    expect(matchPlatform('https://tidal.com/browse/track/1')?.key).toBe('tidal')
    expect(matchPlatform('https://www.youtube.com/watch?v=x')?.key).toBe('youtube')
    expect(matchPlatform('https://music.youtube.com/watch?v=x')?.key).toBe('youtube_music')
  })

  it('does not classify unknown or malformed URLs', () => {
    expect(matchPlatform('https://example.com/song')).toBeNull()
    expect(matchPlatform('https://spotify.example.com/track')).toBeNull()
    expect(matchPlatform('not a url')).toBeNull()
  })
})

describe('SongLinks', () => {
  beforeEach(() => {
    vi.mocked(addSongLink).mockReset()
    vi.mocked(deleteSongLink).mockReset()
  })

  it('shows "Add links" when there are no links', () => {
    wrap({ initialLinks: [] })
    expect(screen.getByRole('button', { name: 'Add links' })).toBeInTheDocument()
  })

  it('shows "Edit links" when links exist', () => {
    wrap({ initialLinks: [SPOTIFY_LINK] })
    expect(screen.getByRole('button', { name: 'Edit links' })).toBeInTheDocument()
  })

  it('shows a platform link under the platform name, without the raw URL', () => {
    wrap({ initialLinks: [SPOTIFY_LINK] })
    const link = screen.getByRole('link', { name: 'Spotify' })
    expect(link).toHaveAttribute('href', SPOTIFY_LINK.url)
    expect(screen.queryByText(SPOTIFY_LINK.url)).not.toBeInTheDocument()
  })

  it('shows a non-platform link under its label', () => {
    wrap({ initialLinks: [OTHER_LINK] })
    expect(screen.getByRole('link', { name: 'Band wiki' })).toHaveAttribute('href', OTHER_LINK.url)
  })

  it('hides the edit button without write permission', () => {
    wrap({ initialLinks: [SPOTIFY_LINK], canWrite: false })
    expect(screen.queryByRole('button', { name: 'Edit links' })).not.toBeInTheDocument()
  })

  it('moves a platform from the grid to an expanded URL row when its + is clicked', async () => {
    const user = userEvent.setup()
    wrap({ initialLinks: [] })

    await user.click(screen.getByRole('button', { name: 'Add links' }))
    expect(screen.getByRole('button', { name: 'Add Deezer link' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add Spotify link' }))
    expect(screen.getByPlaceholderText('https://open.spotify.com/')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add Spotify link' })).not.toBeInTheDocument()
  })

  it('does not offer a platform in the grid when a link for it already exists', async () => {
    const user = userEvent.setup()
    wrap({ initialLinks: [SPOTIFY_LINK] })

    await user.click(screen.getByRole('button', { name: 'Edit links' }))
    expect(screen.queryByRole('button', { name: 'Add Spotify link' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add Deezer link' })).toBeInTheDocument()
  })

  it('rejects a URL that does not match the platform prefix', async () => {
    const user = userEvent.setup()
    wrap({ initialLinks: [] })

    await user.click(screen.getByRole('button', { name: 'Add links' }))
    await user.click(screen.getByRole('button', { name: 'Add Spotify link' }))
    await user.type(screen.getByPlaceholderText('https://open.spotify.com/'), 'https://example.com/x')
    await user.click(screen.getByRole('button', { name: 'Finished' }))

    expect(addSongLink).not.toHaveBeenCalled()
    expect(screen.getByText('URL must start with https://open.spotify.com/')).toBeInTheDocument()
    // stays in edit mode
    expect(screen.getByRole('button', { name: 'Finished' })).toBeInTheDocument()
  })

  it('saves a valid platform link on Finished and leaves edit mode', async () => {
    const user = userEvent.setup()
    const url = 'https://open.spotify.com/track/new'
    addSongLink.mockResolvedValue({ id: 9, label: 'Spotify', url })
    wrap({ initialLinks: [] })

    await user.click(screen.getByRole('button', { name: 'Add links' }))
    await user.click(screen.getByRole('button', { name: 'Add Spotify link' }))
    await user.type(screen.getByPlaceholderText('https://open.spotify.com/'), url)
    await user.click(screen.getByRole('button', { name: 'Finished' }))

    expect(addSongLink).toHaveBeenCalledWith(7, { label: 'Spotify', url })
    await waitFor(() => expect(screen.getByRole('link', { name: 'Spotify' })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Edit links' })).toBeInTheDocument()
  })

  it('saves an "other" link with a freeform label', async () => {
    const user = userEvent.setup()
    const url = 'https://example.com/wiki'
    addSongLink.mockResolvedValue({ id: 10, label: 'Band wiki', url })
    wrap({ initialLinks: [] })

    await user.click(screen.getByRole('button', { name: 'Add links' }))
    await user.click(screen.getByRole('button', { name: 'Add Other link' }))
    await user.type(screen.getByLabelText('Label'), 'Band wiki')
    await user.type(screen.getByLabelText('URL'), url)
    await user.click(screen.getByRole('button', { name: 'Finished' }))

    expect(addSongLink).toHaveBeenCalledWith(7, { label: 'Band wiki', url })
    await waitFor(() => expect(screen.getByRole('link', { name: 'Band wiki' })).toBeInTheDocument())
  })

  it('discards an empty draft row on Finished', async () => {
    const user = userEvent.setup()
    wrap({ initialLinks: [] })

    await user.click(screen.getByRole('button', { name: 'Add links' }))
    await user.click(screen.getByRole('button', { name: 'Add Spotify link' }))
    await user.click(screen.getByRole('button', { name: 'Finished' }))

    expect(addSongLink).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Add links' })).toBeInTheDocument()
  })

  it('deletes a link in edit mode', async () => {
    const user = userEvent.setup()
    deleteSongLink.mockResolvedValue(undefined)
    wrap({ initialLinks: [SPOTIFY_LINK] })

    await user.click(screen.getByRole('button', { name: 'Edit links' }))
    await user.click(screen.getByRole('button', { name: 'delete link' }))

    expect(deleteSongLink).toHaveBeenCalledWith(7, 1)
    // Spotify returns to the grid once its link is gone
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add Spotify link' })).toBeInTheDocument())
  })
})
