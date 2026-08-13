import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../songs/songs.ts', () => ({ getSong: vi.fn() }))

import SetlistItemSourcePicker from '../components/SetlistItemSourcePicker.tsx'
import { getSong } from '../../songs/songs.ts'
import theme from '../../../theme.ts'

const ITEM = { id: 100, item_type: 'song', song_id: 42, chart_id: null, document_id: null }

const SONG = {
  id: 42,
  title: 'Creep',
  chordpro_charts: [
    { id: 7, name: 'Guitar' },
    { id: 8, name: 'Piano (Bb)' },
  ],
  documents: [
    { id: 9, object_key: 'tenants/1/song_documents/sheet.pdf', original_filename: 'sheet.pdf' },
  ],
}

function wrap(item = ITEM, onSelect = vi.fn()) {
  render(
    <ThemeProvider theme={theme}>
      <MemoryRouter>
        <SetlistItemSourcePicker open item={item} onClose={vi.fn()} onSelect={onSelect} />
      </MemoryRouter>
    </ThemeProvider>,
  )
  return onSelect
}

beforeEach(() => {
  vi.clearAllMocks()
  getSong.mockResolvedValue(SONG)
})

describe('SetlistItemSourcePicker', () => {
  it('lists the song\'s charts and PDFs', async () => {
    wrap()
    expect(await screen.findByText('Guitar')).toBeInTheDocument()
    expect(screen.getByText('Piano (Bb)')).toBeInTheDocument()
    expect(screen.getByText('sheet.pdf')).toBeInTheDocument()
  })

  it('patches the item with the chosen chart', async () => {
    const user = userEvent.setup()
    const onSelect = wrap()
    await user.click(await screen.findByRole('radio', { name: /Guitar/ }))
    expect(onSelect).toHaveBeenCalledWith({ chart_id: 7 })
  })

  it('patches the item with the chosen document', async () => {
    const user = userEvent.setup()
    const onSelect = wrap()
    await user.click(await screen.findByRole('radio', { name: /sheet\.pdf/ }))
    expect(onSelect).toHaveBeenCalledWith({ document_id: 9 })
  })

  it('preselects the assigned source', async () => {
    wrap({ ...ITEM, document_id: 9 })
    expect(await screen.findByRole('radio', { name: /sheet\.pdf/ })).toBeChecked()
  })

  it('clears the source with "Nothing"', async () => {
    const user = userEvent.setup()
    const onSelect = wrap({ ...ITEM, chart_id: 7 })
    await user.click(await screen.findByRole('radio', { name: 'Nothing' }))
    expect(onSelect).toHaveBeenCalledWith({ chart_id: null })
  })

  it('points at the song page when there is nothing to pick', async () => {
    getSong.mockResolvedValue({ id: 42, title: 'Creep', chordpro_charts: [], documents: [] })
    wrap()
    expect(await screen.findByText('This song has no charts or PDFs yet.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add one on the song page' })).toHaveAttribute('href', '/songs/42')
  })

  it('reports a failed load', async () => {
    getSong.mockRejectedValue(new Error('nope'))
    wrap()
    expect(await screen.findByText("Failed to load this song's files")).toBeInTheDocument()
  })
})
