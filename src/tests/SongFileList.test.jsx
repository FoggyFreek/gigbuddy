import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it, vi } from 'vitest'

import SongFileList from '../components/SongFileList.tsx'
import { CompactLayoutContext } from '../hooks/useCompactLayout.ts'
import theme from '../theme.ts'

const RECORDING = {
  id: 3,
  object_key: 'tenants/1/song-recordings/abc',
  original_filename: 'demo.mp3',
  file_size: 2_400_000,
}
const DOCUMENT = {
  id: 4,
  object_key: 'tenants/1/song-documents/def',
  original_filename: 'chart.pdf',
  file_size: 51_200,
}

function wrap(props = {}, { compact = false } = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <CompactLayoutContext.Provider value={compact}>
        <MemoryRouter>
          <SongFileList
            songId={7}
            accept=".mp3,audio/mpeg"
            maxBytes={10 * 1024 * 1024}
            uploadFn={vi.fn()}
            deleteFn={vi.fn()}
            {...props}
          />
        </MemoryRouter>
      </CompactLayoutContext.Provider>
    </ThemeProvider>,
  )
}

describe('SongFileList', () => {
  it('links a file to its download URL', () => {
    wrap({ initialFiles: [DOCUMENT] })
    expect(screen.getByRole('link', { name: 'chart.pdf' })).toHaveAttribute(
      'href',
      `/api/files/${DOCUMENT.object_key}`,
    )
  })

  it('renders no player for non-audio files', () => {
    const { container } = wrap({ initialFiles: [DOCUMENT] })
    expect(container.querySelector('audio')).toBeNull()
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
  })

  it('renders the rich audio player for audio files, not the native controls', () => {
    const { container } = wrap({ initialFiles: [RECORDING], isAudio: true })

    const player = screen.getByRole('group', { name: 'Audio player for demo.mp3' })
    expect(player).toBeInTheDocument()

    const audio = container.querySelector('audio')
    // ?inline=1 keeps the response from carrying Content-Disposition: attachment.
    expect(audio).toHaveAttribute('src', `/api/files/${RECORDING.object_key}?inline=1`)
    expect(audio).not.toHaveAttribute('controls')

    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mute' })).toBeInTheDocument()
  })

  it('renders one player per audio file', () => {
    const second = { ...RECORDING, id: 5, object_key: 'tenants/1/song-recordings/xyz', original_filename: 'live.mp3' }
    wrap({ initialFiles: [RECORDING, second], isAudio: true })

    expect(screen.getByRole('group', { name: 'Audio player for demo.mp3' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Audio player for live.mp3' })).toBeInTheDocument()
  })

  it('drops the volume control on compact layouts, keeping play/pause', () => {
    wrap({ initialFiles: [RECORDING], isAudio: true }, { compact: true })

    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mute' })).not.toBeInTheDocument()
  })

  it('hides the delete button without write permission', () => {
    wrap({ initialFiles: [RECORDING], isAudio: true, canWrite: false })
    expect(screen.queryByRole('button', { name: 'delete file' })).not.toBeInTheDocument()
  })
})
