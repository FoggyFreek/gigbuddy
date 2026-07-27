import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/gigs.ts', () => ({
  searchGigs: vi.fn(),
  getGig: vi.fn(),
}))
vi.mock('../api/profile.ts', () => ({
  updateProfile: vi.fn(),
  uploadMemoryImage: vi.fn(),
  deleteMemoryImage: vi.fn(),
}))

import { getGig, searchGigs } from '../api/gigs.ts'
import { updateProfile } from '../api/profile.ts'
import MemoryTile from '../components/dashboard/MemoryTile.tsx'
import theme from '../theme.ts'

const SUMMER_FEST = { id: 7, event_date: '2026-07-20', event_description: 'Summer Fest' }

// Stands in for the dashboard page: holds the persisted profile fields and
// applies `onSaved` patches, so the tile sees real prop updates after a save.
function Harness({ initial = {}, gigs = [] }) {
  const [profile, setProfile] = useState({
    memory_image_path: null,
    memory_caption: null,
    memory_gig_id: null,
    ...initial,
  })
  return (
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <MemoryTile
          imagePath={profile.memory_image_path}
          caption={profile.memory_caption}
          gigId={profile.memory_gig_id}
          gigs={gigs}
          canEdit
          onSaved={(patch) => setProfile((prev) => ({ ...prev, ...patch }))}
        />
      </ThemeProvider>
    </MemoryRouter>
  )
}

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

// The edit toggle mounts and unmounts the caption field and the gig picker, so
// their local state has no lifetime beyond an edit session. These cover what
// that lifecycle is relied on to do — and what must survive it in the parent.
describe('MemoryTile edit-mode lifecycle', () => {
  it('mounts the gig picker only while editing, so no search runs in the read view', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    expect(screen.queryByLabelText('Link a past gig')).not.toBeInTheDocument()
    expect(searchGigs).not.toHaveBeenCalled()

    await user.click(screen.getByLabelText('Edit memory'))

    expect(screen.getByLabelText('Link a past gig')).toBeInTheDocument()
  })

  it('resets the gig search when edit mode closes', async () => {
    searchGigs.mockResolvedValue([SUMMER_FEST])
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByLabelText('Edit memory'))
    await user.type(screen.getByLabelText('Link a past gig'), 'Sum')
    await waitFor(() => expect(searchGigs).toHaveBeenCalledWith('Sum'))
    expect(await screen.findByRole('option', { name: /Summer Fest/ })).toBeInTheDocument()

    await user.click(screen.getByLabelText('Done'))
    searchGigs.mockClear()
    await user.click(screen.getByLabelText('Edit memory'))

    // Unmounting is the cleanup: no stale query, no stale options, no refetch.
    expect(screen.getByLabelText('Link a past gig')).toHaveValue('')
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
    expect(searchGigs).not.toHaveBeenCalled()
  })

  it('keeps the linked-gig chip after the picker unmounts', async () => {
    // `gigs` is empty on purpose: the picked gig came from search results that
    // die with the picker, so only the parent-held selection can resolve it.
    searchGigs.mockResolvedValue([SUMMER_FEST])
    getGig.mockResolvedValue(SUMMER_FEST)
    updateProfile.mockResolvedValue({})
    const user = userEvent.setup()
    render(<Harness gigs={[]} />)

    await user.click(screen.getByLabelText('Edit memory'))
    await user.type(screen.getByLabelText('Link a past gig'), 'Sum')
    await user.click(await screen.findByRole('option', { name: /Summer Fest/ }))
    await waitFor(() => expect(updateProfile).toHaveBeenCalledWith({ memory_gig_id: 7 }))

    await user.click(screen.getByLabelText('Done'))

    expect(screen.queryByLabelText('Link a past gig')).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /Summer Fest/ })).toBeInTheDocument()
  })

  it('flushes a pending caption save before the field unmounts, and only once', async () => {
    updateProfile.mockResolvedValue({})
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByLabelText('Edit memory'))

    // Fake timers only around the debounce, driven by fireEvent — userEvent
    // deadlocks against them here.
    vi.useFakeTimers()
    try {
      fireEvent.change(screen.getByLabelText('Caption'), { target: { value: 'Best night' } })
      expect(updateProfile).not.toHaveBeenCalled()

      fireEvent.click(screen.getByLabelText('Done'))
      await vi.runAllTimersAsync()

      // Closing flushes the debounce; the dropped draft can't fire a second save.
      expect(updateProfile).toHaveBeenCalledTimes(1)
      expect(updateProfile).toHaveBeenCalledWith({ memory_caption: 'Best night' })
    } finally {
      vi.useRealTimers()
    }

    // The flushed value round-trips through onSaved into the read view.
    await waitFor(() => expect(screen.getByText('Best night')).toBeInTheDocument())
    expect(updateProfile).toHaveBeenCalledTimes(1)
  })

  it('re-seeds the caption field from the persisted prop when editing reopens', async () => {
    const user = userEvent.setup()
    render(<Harness initial={{ memory_caption: 'Persisted caption' }} />)

    await user.click(screen.getByLabelText('Edit memory'))
    const field = screen.getByLabelText('Caption')
    expect(field).toHaveValue('Persisted caption')

    await user.clear(field)
    await user.type(field, 'Draft that never persists')
    updateProfile.mockRejectedValueOnce(new Error('save failed'))
    await user.click(screen.getByLabelText('Done'))

    // The draft died with the field, so reopening shows the persisted value.
    await user.click(screen.getByLabelText('Edit memory'))
    expect(screen.getByLabelText('Caption')).toHaveValue('Persisted caption')
  })
})
