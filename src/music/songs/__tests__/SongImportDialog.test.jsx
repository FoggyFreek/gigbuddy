import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SongImportDialog from '../components/SongImportDialog.tsx'
import { importSongs } from '../songs.ts'
import theme from '../../../theme.ts'

vi.mock('../songs.ts', () => ({ importSongs: vi.fn() }))

function wrap() {
  render(
    <ThemeProvider theme={theme}>
      <SongImportDialog onClose={() => {}} />
    </ThemeProvider>,
  )
}

function upload(csv) {
  return userEvent.upload(
    document.querySelector('input[type="file"]'),
    new File([csv], 'songs.csv', { type: 'text/csv' }),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  importSongs.mockResolvedValue({ imported: 1, skipped: 0 })
})

describe('SongImportDialog', () => {
  it('parses durations as mm:ss, h:mm:ss or plain seconds, and rejects junk', async () => {
    wrap()
    await upload([
      'Title,Length',
      'Short,3:45',
      'Long,1:02:03',
      'Seconds,225',
      'Junk,about four minutes',
      'Empty,',
    ].join('\n'))

    await userEvent.click(await screen.findByRole('button', { name: 'Preview' }))
    await userEvent.click(screen.getByRole('button', { name: 'Import 5 rows' }))

    await waitFor(() => expect(importSongs).toHaveBeenCalledTimes(1))
    expect(importSongs.mock.calls[0][0].map((r) => r.duration_seconds)).toEqual([
      225, 3723, 225, null, null,
    ])
  })

  it('maps song aliases and coerces tempo to a number', async () => {
    wrap()
    await upload('Song,Band,Album,Releasedate,Key,BPM,Genre\nParadise,The Band,Blue Sky,2024-05-17,Am,120,rock')

    await userEvent.click(await screen.findByRole('button', { name: 'Preview' }))
    await userEvent.click(screen.getByRole('button', { name: 'Import 1 row' }))

    await waitFor(() => expect(importSongs).toHaveBeenCalledTimes(1))
    expect(importSongs).toHaveBeenCalledWith([{
      title: 'Paradise',
      artist: 'The Band',
      album: 'Blue Sky',
      release_date: '2024-05-17',
      song_key: 'Am',
      tempo: 120,
      duration_seconds: null,
      tags: 'rock',
    }])
  })

  it('requires the title column with its own message and skips untitled rows', async () => {
    wrap()
    await upload('Nickname,Artist\nParadise,The Band')

    await userEvent.click(await screen.findByRole('button', { name: 'Preview' }))
    expect(screen.getByText('Title column is required')).toBeInTheDocument()
  })

  it('previews the mapped song columns', async () => {
    wrap()
    await upload('Title,Artist,Album,Release date,Key,Tempo,Tags\nParadise,The Band,Blue Sky,2024-05-17,Am,120,rock')

    await userEvent.click(await screen.findByRole('button', { name: 'Preview' }))

    const headers = screen.getAllByRole('columnheader').map((c) => c.textContent)
    expect(headers).toEqual(['Title', 'Artist', 'Album', 'Release date', 'Key', 'Tempo', 'Tags'])
    const cells = screen.getAllByRole('cell').map((c) => c.textContent)
    expect(cells).toEqual(['Paradise', 'The Band', 'Blue Sky', '2024-05-17', 'Am', '120', 'rock'])
  })
})
