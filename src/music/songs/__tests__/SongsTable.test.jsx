import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it, vi } from 'vitest'
import SongsTable from '../components/SongsTable.tsx'
import theme from '../../../theme.ts'
import { CompactLayoutContext } from '../../../hooks/useCompactLayout.ts'

const SONG = {
  id: 1,
  title: 'Paranoid Android',
  artist: 'Radiohead',
  album_id: 3,
  album: { id: 3, title: 'OK Computer', release_date: '1997-05-21' },
  tags: [],
}

function wrap(compact = false, songs = [SONG]) {
  return render(
    <ThemeProvider theme={theme}>
      <CompactLayoutContext.Provider value={compact}>
        <SongsTable songs={songs} onRowClick={vi.fn()} />
      </CompactLayoutContext.Provider>
    </ThemeProvider>,
  )
}

describe('SongsTable albums', () => {
  it('shows an Album column in the table view', () => {
    wrap()
    expect(screen.getByRole('columnheader', { name: 'Album' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'OK Computer' })).toBeInTheDocument()
  })

  it('shows artist, album title and release year on the compact card second row', () => {
    const { container } = wrap(true)
    const card = within(container.querySelector('.MuiPaper-root'))
    expect(card.getByText('Radiohead - OK Computer(1997)')).toBeInTheDocument()
  })

  it('filters songs by album', async () => {
    const user = userEvent.setup()
    wrap(false, [
      SONG,
      {
        id: 2,
        title: 'Everything in Its Right Place',
        artist: 'Radiohead',
        album_id: 4,
        album: { id: 4, title: 'Kid A', release_date: '2000-10-02' },
        tags: [],
      },
      { id: 3, title: 'Unreleased Song', artist: 'Radiohead', album: null, tags: [] },
    ])

    await user.click(screen.getByRole('button', { name: 'Filter' }))
    await user.click(screen.getByRole('menuitem', { name: 'All albums' }))
    await user.click(screen.getByRole('menuitem', { name: 'OK Computer' }))

    expect(screen.getByText('Paranoid Android')).toBeInTheDocument()
    expect(screen.queryByText('Everything in Its Right Place')).not.toBeInTheDocument()
    expect(screen.queryByText('Unreleased Song')).not.toBeInTheDocument()
  })
})
