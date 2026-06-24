import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/songs.ts', () => ({
  createSong: vi.fn(),
  deleteSong: vi.fn(),
  uploadSongChart: vi.fn().mockResolvedValue({ id: 10, name: 'molly' }),
  importSongs: vi.fn(),
}))

// Stub the heavy CSV dialog; expose its onClose so we can simulate a reload.
vi.mock('../components/SongImportDialog.tsx', () => ({
  default: ({ onClose }) => (
    <div data-testid="csv-dialog">
      <button onClick={() => onClose(true)}>finish import</button>
      <button onClick={() => onClose(false)}>cancel import</button>
    </div>
  ),
}))

import SongImportMenu from '../components/SongImportMenu.tsx'
import { createSong, deleteSong, uploadSongChart } from '../api/songs.ts'
import theme from '../theme.ts'

function wrap(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

describe('SongImportMenu — ChordPro import', () => {
  beforeEach(() => {
    createSong.mockReset()
    createSong.mockResolvedValue({ id: 7, title: 'Molly' })
    uploadSongChart.mockReset()
    uploadSongChart.mockResolvedValue({ id: 10, name: 'molly' })
    deleteSong.mockReset()
    deleteSong.mockResolvedValue(undefined)
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

  it('deletes the created song when the chart upload is rejected', async () => {
    uploadSongChart.mockRejectedValue(new Error('File is not a valid ChordPro text file'))
    const onImported = vi.fn()
    const onSongCreated = vi.fn()
    const { container } = wrap(<SongImportMenu onImported={onImported} onSongCreated={onSongCreated} />)

    const file = new File(['{title: Molly}\n[C]hi'], 'whatever.pro', { type: 'text/plain' })
    const input = container.querySelector('input[type="file"]')
    await userEvent.upload(input, file)

    await waitFor(() => expect(deleteSong).toHaveBeenCalledWith(7))
    expect(onImported).not.toHaveBeenCalled()
    expect(onSongCreated).not.toHaveBeenCalled()
    expect(await screen.findByText('File is not a valid ChordPro text file')).toBeInTheDocument()
  })

  it('offers CSV and ChordPro options under the Import button', async () => {
    const user = userEvent.setup()
    wrap(<SongImportMenu onImported={vi.fn()} onSongCreated={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Import' }))

    expect(screen.getByText(/From CSV/)).toBeInTheDocument()
    expect(screen.getByText(/From ChordPro file/)).toBeInTheDocument()
  })

  it('rejects a file over the 512 KB limit without creating a song', async () => {
    const { container } = wrap(<SongImportMenu onImported={vi.fn()} onSongCreated={vi.fn()} />)

    const tooBig = new File(['x'.repeat(512 * 1024 + 1)], 'big.pro', { type: 'text/plain' })
    const input = container.querySelector('input[type="file"]')
    await userEvent.upload(input, tooBig)

    expect(await screen.findByText(/512 KB limit/i)).toBeInTheDocument()
    expect(createSong).not.toHaveBeenCalled()
  })

  it('opens the CSV import dialog and reloads on a successful import', async () => {
    const onImported = vi.fn()
    const user = userEvent.setup()
    wrap(<SongImportMenu onImported={onImported} onSongCreated={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Import' }))
    await user.click(screen.getByText(/From CSV/))
    expect(screen.getByTestId('csv-dialog')).toBeInTheDocument()

    await user.click(screen.getByText('finish import'))
    expect(onImported).toHaveBeenCalled()
    expect(screen.queryByTestId('csv-dialog')).not.toBeInTheDocument()
  })

  it('does not reload when the CSV dialog is cancelled', async () => {
    const onImported = vi.fn()
    const user = userEvent.setup()
    wrap(<SongImportMenu onImported={onImported} onSongCreated={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Import' }))
    await user.click(screen.getByText(/From CSV/))
    await user.click(screen.getByText('cancel import'))

    expect(onImported).not.toHaveBeenCalled()
    expect(screen.queryByTestId('csv-dialog')).not.toBeInTheDocument()
  })

  it('triggers the hidden file input when choosing ChordPro import', async () => {
    const user = userEvent.setup()
    const { container } = wrap(<SongImportMenu onImported={vi.fn()} onSongCreated={vi.fn()} />)

    const input = container.querySelector('input[type="file"]')
    const clickSpy = vi.spyOn(input, 'click').mockImplementation(() => {})

    await user.click(screen.getByRole('button', { name: 'Import' }))
    await user.click(screen.getByText(/From ChordPro file/))

    expect(clickSpy).toHaveBeenCalled()
  })
})
