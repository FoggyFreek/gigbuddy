import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it, vi } from 'vitest'
import theme from '../../../theme.ts'

vi.mock('../songs.ts', () => ({
  listAlbums: vi.fn(),
  createAlbum: vi.fn(),
  updateAlbum: vi.fn(),
  uploadAlbumArt: vi.fn(),
  deleteAlbumArt: vi.fn(),
  createSong: vi.fn(),
  setSongCoverFromAlbum: vi.fn(),
}))

import SongFormModal from '../components/SongFormModal.tsx'
import { createSong, listAlbums, setSongCoverFromAlbum } from '../songs.ts'

describe('SongFormModal', () => {
  it('waits until Add song is clicked before asking to use selected album art', async () => {
    const album = {
      id: 9,
      title: 'OK Computer',
      release_date: '1997-05-21',
      album_art_url: 'tenants/1/album-art/ok.webp',
    }
    listAlbums.mockResolvedValue([album])
    createSong.mockResolvedValue({ id: 4, title: 'Airbag', album_id: 9, album })
    setSongCoverFromAlbum.mockResolvedValue({ cover_image_path: 'tenants/1/song_covers/airbag.webp' })
    const onCreated = vi.fn()
    const user = userEvent.setup()

    render(
      <ThemeProvider theme={theme}>
        <SongFormModal onClose={vi.fn()} onCreated={onCreated} />
      </ThemeProvider>,
    )

    await user.type(screen.getByLabelText(/^Title/), 'Airbag')
    await user.click(screen.getByLabelText('Album'))
    await user.click(await screen.findByRole('option', { name: /OK Computer/i }))

    expect(screen.queryByRole('dialog', { name: 'Use album art?' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add song' }))
    const prompt = await screen.findByRole('dialog', { name: 'Use album art?' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    await user.click(within(prompt).getByRole('button', { name: 'Use album art' }))

    await waitFor(() => expect(createSong).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Airbag',
      album_id: 9,
    })))
    expect(setSongCoverFromAlbum).toHaveBeenCalledWith(4, 9)
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({
      cover_image_path: 'tenants/1/song_covers/airbag.webp',
    }))
  })
})
