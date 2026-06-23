import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let mockStacked = false
vi.mock('@mui/material/useMediaQuery', () => ({
  default: () => mockStacked,
}))

vi.mock('../components/ChordProView.tsx', () => ({
  default: ({ source }) => <div>Rendered chart: {source}</div>,
}))

vi.mock('../api/songs.ts', () => ({
  updateSongChart: vi.fn(),
}))

import ChordProViewerDialog from '../components/ChordProViewerDialog.tsx'
import theme from '../theme.ts'

const CHART = {
  id: 10,
  name: 'Guitar',
  source: '[C]Hello',
}

function wrap(props = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <ChordProViewerDialog
        open
        songId={1}
        chart={CHART}
        canWrite
        startInEdit
        onClose={() => {}}
        onChartChange={() => {}}
        {...props}
      />
    </ThemeProvider>,
  )
}

describe('ChordProViewerDialog', () => {
  beforeEach(() => {
    mockStacked = false
  })

  it('keeps the live preview next to the editor on wide screens', () => {
    wrap()

    expect(screen.getByLabelText(/chordpro source/i)).toBeInTheDocument()
    expect(screen.getByText('Rendered chart: [C]Hello')).toBeInTheDocument()
  })

  it('hides the edit-mode preview on compact screens until Preview is clicked', async () => {
    mockStacked = true
    const user = userEvent.setup()
    wrap()

    expect(screen.getByLabelText(/chordpro source/i)).toBeInTheDocument()
    expect(screen.queryByText('Rendered chart: [C]Hello')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^preview$/i }))

    expect(screen.getByText('Rendered chart: [C]Hello')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument()
  })
})
