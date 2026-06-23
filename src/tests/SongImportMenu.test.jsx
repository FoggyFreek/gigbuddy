import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/songs.ts', () => ({
  createSong: vi.fn(),
  uploadSongChart: vi.fn().mockResolvedValue({ id: 10, name: 'molly' }),
  importSongs: vi.fn(),
}))

import SongImportMenu from '../components/SongImportMenu.tsx'
import { createSong, uploadSongChart } from '../api/songs.ts'
import theme from '../theme.ts'

function wrap(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

describe('SongImportMenu — ChordPro import', () => {
  beforeEach(() => {
    createSong.mockReset()
    createSong.mockResolvedValue({ id: 7, title: 'Molly' })
    uploadSongChart.mockClear()
  })

  it('creates a song from the file metadata and attaches the chart', async () => {
    const onImported = vi.fn()
    const onSongCreated = vi.fn()
    const { container } = wrap(<SongImportMenu onImported={onImported} onSongCreated={onSongCreated} />)

    const file = new File(
      ['{title: Molly}\n{artist: Trad}\n{key: G}\n{tempo: 120}\n[C]hi'],
      'whatever.pro',
      { type: 'text/plain' },
    )
    const input = container.querySelector('input[type="file"]')
    await userEvent.upload(input, file)

    await waitFor(() =>
      expect(createSong).toHaveBeenCalledWith({
        title: 'Molly',
        artist: 'Trad',
        song_key: 'G',
        tempo: 120,
        lyrics_html: '<p>hi</p>',
      }),
    )
    expect(uploadSongChart).toHaveBeenCalledWith(7, file)
    expect(onImported).toHaveBeenCalled()
    expect(onSongCreated).toHaveBeenCalledWith({ id: 7, title: 'Molly' })
  })

  it('falls back to the filename when the file has no {title}', async () => {
    wrap(<SongImportMenu onImported={vi.fn()} onSongCreated={vi.fn()} />)

    const file = new File(['[C]just chords'], 'My Song.pro', { type: 'text/plain' })
    const input = document.querySelector('input[type="file"]')
    await userEvent.upload(input, file)

    await waitFor(() =>
      expect(createSong).toHaveBeenCalledWith({
        title: 'My Song',
        artist: null,
        song_key: null,
        tempo: null,
        lyrics_html: '<p>just chords</p>',
      }),
    )
  })

  it('offers CSV and ChordPro options under the Import button', async () => {
    const user = userEvent.setup()
    wrap(<SongImportMenu onImported={vi.fn()} onSongCreated={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Import' }))

    expect(screen.getByText(/From CSV/)).toBeInTheDocument()
    expect(screen.getByText(/From ChordPro file/)).toBeInTheDocument()
  })
})
