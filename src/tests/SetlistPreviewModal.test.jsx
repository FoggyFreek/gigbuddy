import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it, vi } from 'vitest'

import SetlistPreviewModal from '../components/setlist/SetlistPreviewModal.tsx'
import theme from '../theme.ts'

const song = (id, title, extra = {}) => ({
  id, item_type: 'song', title, song_key: 'G', tempo: 120,
  duration_seconds: 100, linked_to_next: false, transition_note: null, ...extra,
})

const pause = (id, extra = {}) => ({
  id, item_type: 'pause', label: 'Coffee', duration_seconds: 60, ...extra,
})

function wrap(props) {
  return render(
    <ThemeProvider theme={theme}>
      <SetlistPreviewModal open onClose={() => {}} setlistName="My List" sets={[]} {...props} />
    </ThemeProvider>,
  )
}

// The modal renders both the on-screen preview and a hidden print portal with the
// same content, so titles appear twice. Scope queries to the visible dialog.
function inDialog() {
  return within(screen.getByRole('dialog'))
}

describe('SetlistPreviewModal', () => {
  it('hides key values when "Show Key" is toggled off', async () => {
    const user = userEvent.setup()
    wrap({ sets: [{ id: 1, name: 'Set 1', items: [song(100, 'Creep', { song_key: 'Am' })] }] })
    const dialog = inDialog()
    expect(dialog.getByText('Am')).toBeInTheDocument()

    await user.click(screen.getByLabelText('Show Key'))

    expect(inDialog().queryByText('Am')).not.toBeInTheDocument()
  })

  it('hides BPM values when "Show BPM" is toggled off', async () => {
    const user = userEvent.setup()
    wrap({ sets: [{ id: 1, name: 'Set 1', items: [song(100, 'Creep', { tempo: 92 })] }] })
    expect(inDialog().getByText(/92 BPM/)).toBeInTheDocument()

    await user.click(screen.getByLabelText('Show BPM'))

    expect(inDialog().queryByText(/92 BPM/)).not.toBeInTheDocument()
  })

  it('hides pauses and breaks by default and shows them when toggled on', async () => {
    const user = userEvent.setup()
    wrap({ sets: [{ id: 1, name: 'Set 1', items: [song(100, 'Creep'), pause(200)] }] })
    expect(inDialog().queryByText('Coffee')).not.toBeInTheDocument()

    await user.click(screen.getByLabelText('Show Pauses & Breaks'))

    expect(inDialog().getByText('Coffee')).toBeInTheDocument()
  })

  it('renders no key/BPM for non-song items', async () => {
    const user = userEvent.setup()
    wrap({ sets: [{ id: 1, name: 'Set 1', items: [pause(200, { duration_seconds: 60 })] }] })
    await user.click(screen.getByLabelText('Show Pauses & Breaks'))

    const dialog = inDialog()
    expect(dialog.getByText('Coffee')).toBeInTheDocument()
    expect(dialog.queryByText('G')).not.toBeInTheDocument()
    // The "Show BPM" toggle label lives in the dialog too; assert no BPM *value*.
    expect(dialog.queryByText(/\d+\s*BPM/)).not.toBeInTheDocument()
  })

  it('renders an empty set without crashing', () => {
    wrap({ sets: [{ id: 1, name: 'Empty Set', items: [] }] })
    expect(inDialog().getByText('(No songs)')).toBeInTheDocument()
  })

  it('renders a transition note between two linked songs', () => {
    wrap({
      sets: [{
        id: 1,
        name: 'Set 1',
        items: [
          song(100, 'Creep', { linked_to_next: true, transition_note: 'segue' }),
          song(101, 'No Surprises'),
        ],
      }],
    })
    expect(inDialog().getByText(/segue/)).toBeInTheDocument()
  })

  it('shows the member’s own note only when "Show notes" is on', async () => {
    const user = userEvent.setup()
    wrap({ sets: [{ id: 1, name: 'Set 1', items: [song(100, 'Creep', { my_note: 'capo 2' })] }] })
    // Hidden by default.
    expect(inDialog().queryByText(/capo 2/)).not.toBeInTheDocument()

    await user.click(screen.getByLabelText('Show notes'))

    expect(inDialog().getByText(/capo 2/)).toBeInTheDocument()
  })

  it('uses a responsive preview frame that can shrink to the dialog width', () => {
    wrap({ sets: [{ id: 1, name: 'Set 1', items: [song(100, 'Creep')] }] })

    const frame = screen.getByTestId('setlist-preview-frame')
    const page = screen.getByTestId('setlist-preview-page')

    expect(frame.style.width).toBe('100%')
    expect(frame.style.maxWidth).toMatch(/^[\d.]+px$/)
    expect(frame.style.aspectRatio).toMatch(/^[\d.]+ \/ [\d.]+$/)
    expect(frame.style.overflow).toBe('hidden')
    expect(page.style.padding).toMatch(/^[\d.]+cqw$/)
    expect(page.style.fontSize).toMatch(/^[\d.]+cqw$/)
  })

  it('calls window.print when the Print button is clicked', async () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {})
    const user = userEvent.setup()
    wrap({ sets: [{ id: 1, name: 'Set 1', items: [song(100, 'Creep')] }] })

    await user.click(screen.getByRole('button', { name: /print/i }))

    expect(printSpy).toHaveBeenCalledTimes(1)
    printSpy.mockRestore()
  })
})
