import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter, Route, Routes, useSearchParams } from 'react-router'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// dnd-kit measures with ResizeObserver, which jsdom lacks.
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

vi.mock('../setlists.ts', () => ({
  getSetlist: vi.fn(),
  updateSetlist: vi.fn().mockResolvedValue({}),
  deleteSetlist: vi.fn().mockResolvedValue({}),
  addSet: vi.fn(),
  updateSet: vi.fn().mockResolvedValue({}),
  deleteSet: vi.fn().mockResolvedValue({}),
  reorderSets: vi.fn().mockResolvedValue(null),
  addItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn().mockResolvedValue(null),
  reorderItems: vi.fn().mockResolvedValue(null),
  saveItemNote: vi.fn(),
}))

vi.mock('../../songs/songs.ts', () => ({
  listSongs: vi.fn().mockResolvedValue([]),
  getSong: vi.fn().mockResolvedValue({ id: 1, chordpro_charts: [], documents: [] }),
}))

import SetlistEditorPage from '../SetlistEditorPage.tsx'
import { addItem, deleteItem, getSetlist, saveItemNote, updateItem, updateSet, updateSetlist } from '../setlists.ts'
import { getSong } from '../../songs/songs.ts'
import { ToastProvider } from '../../../contexts/ToastContext.tsx'
import theme from '../../../theme.ts'
import { AuthContext } from '../../../contexts/authContext.ts'

// Render as a writer (super admin grants every planning.write capability) so the
// create/edit/delete affordances gated on canWritePlanning are present.
const writerAuth = { user: { isSuperAdmin: true } }

const song = (id, title, extra = {}) => ({
  id, set_id: 10, item_type: 'song', song_id: id - 99, title,
  song_key: 'G', tempo: 90, duration_seconds: 100, tag: null,
  linked_to_next: false, transition_note: null, ...extra,
})

const treeWith = (items) => ({
  id: 5, name: 'My List',
  sets: [{ id: 10, name: 'Set 1', include_in_total: true, sort_order: 0, items }],
})

const TREE = {
  id: 5,
  name: 'My List',
  sets: [
    {
      id: 10,
      name: 'Set 1',
      include_in_total: true,
      sort_order: 0,
      items: [
        { id: 100, set_id: 10, item_type: 'song', song_id: 1, title: 'Creep', song_key: 'G', tempo: 92, duration_seconds: 100, tag: null },
      ],
    },
  ],
}

// Stands in for the performance view, reporting which set it was asked to start
// from so the Start buttons' targets are observable.
function PerformStub() {
  const [params] = useSearchParams()
  return <div>performing from {params.get('set') ?? 'the top'}</div>
}

async function enterEditMode(user) {
  await user.click(screen.getByRole('button', { name: /^edit$/i }))
}

function wrap() {
  return render(
    <MemoryRouter initialEntries={['/setlists/5']}>
      <ThemeProvider theme={theme}>
        <AuthContext.Provider value={writerAuth}>
          <ToastProvider>
            <Routes>
              <Route path="/setlists/:id" element={<SetlistEditorPage />} />
              <Route path="/setlists/:id/perform" element={<PerformStub />} />
            </Routes>
          </ToastProvider>
        </AuthContext.Provider>
      </ThemeProvider>
    </MemoryRouter>,
  )
}

describe('SetlistEditorPage', () => {
  beforeEach(() => {
    getSetlist.mockReset()
    getSetlist.mockResolvedValue(structuredClone(TREE))
    updateSet.mockClear()
    addItem.mockReset()
    updateItem.mockReset()
    deleteItem.mockReset()
    saveItemNote.mockReset()
  })

  it('renders the song card and the computed total', async () => {
    wrap()
    expect(await screen.findByText('Creep')).toBeInTheDocument()
    expect(screen.getByText(/^Total/).textContent).toContain('1:40')
  })

  it('links each song row to its song page', async () => {
    wrap()
    await screen.findByText('Creep')
    expect(screen.getByRole('link', { name: 'open the song page for Creep' }))
      .toHaveAttribute('href', '/songs/1')
  })

  it('starts performance mode from the top', async () => {
    const user = userEvent.setup()
    wrap()
    await screen.findByText('Creep')
    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(await screen.findByText('performing from the top')).toBeInTheDocument()
  })

  it('persists a pending rename before starting the show', async () => {
    const user = userEvent.setup()
    wrap()
    await screen.findByText('Creep')
    await enterEditMode(user)

    await user.clear(screen.getByLabelText('setlist name'))
    await user.type(screen.getByLabelText('setlist name'), 'Renamed')
    // Navigating unmounts the page, which would cancel the debounced save.
    await user.click(screen.getByRole('button', { name: 'Start' }))

    expect(updateSetlist).toHaveBeenCalledWith(5, { name: 'Renamed' })
    expect(await screen.findByText('performing from the top')).toBeInTheDocument()
  })

  it('starts performance mode from a chosen set', async () => {
    const user = userEvent.setup()
    wrap()
    await screen.findByText('Creep')
    await user.click(screen.getByRole('button', { name: 'start playing from Set 1' }))
    expect(await screen.findByText('performing from 10')).toBeInTheDocument()
  })

  it('cannot start the show from a set with nothing in it', async () => {
    getSetlist.mockResolvedValue({
      id: 5,
      name: 'My List',
      sets: [
        { ...TREE.sets[0] },
        { id: 11, name: 'Set 2', include_in_total: true, sort_order: 1, items: [] },
      ],
    })
    wrap()
    await screen.findByText('Creep')
    expect(screen.getByRole('button', { name: 'start playing from Set 2' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'start playing from Set 1' })).toBeEnabled()
  })

  it('assigns a chart to a song from its source picker', async () => {
    const user = userEvent.setup()
    getSong.mockResolvedValue({
      id: 1, chordpro_charts: [{ id: 7, name: 'Guitar' }], documents: [],
    })
    updateItem.mockResolvedValue({ ...song(100, 'Creep'), chart_id: 7, chart_name: 'Guitar' })
    wrap()
    await screen.findByText('Creep')
    await enterEditMode(user)

    await user.click(screen.getByRole('button', { name: 'chart or sheet music for this song' }))
    await user.click(await screen.findByRole('radio', { name: /Guitar/ }))

    expect(updateItem).toHaveBeenCalledWith(5, 100, { chart_id: 7 })
  })

  it('numbers song cards without counting pauses or breaks', async () => {
    getSetlist.mockResolvedValue({
      id: 5,
      name: 'My List',
      sets: [
        {
          id: 10,
          name: 'Set 1',
          include_in_total: true,
          sort_order: 0,
          items: [
            song(100, 'Creep'),
            { id: 200, set_id: 10, item_type: 'pause', duration_seconds: 60, label: null, sort_order: 1 },
          ],
        },
        {
          id: 11,
          name: 'Set 2',
          include_in_total: true,
          sort_order: 1,
          items: [
            { id: 201, set_id: 11, item_type: 'break', duration_seconds: 600, label: null, sort_order: 0 },
            song(101, 'No Surprises', { set_id: 11 }),
          ],
        },
      ],
    })

    wrap()

    expect(await screen.findByText('Creep')).toBeInTheDocument()
    expect(screen.getAllByLabelText('song order 1')).toHaveLength(1)
    expect(screen.getByLabelText('song order 2')).toBeInTheDocument()
    expect(screen.queryByLabelText('song order 3')).not.toBeInTheDocument()
  })

  it('toggling a set out of the total recomputes the displayed total', async () => {
    const user = userEvent.setup()
    wrap()
    await screen.findByText('Creep')
    await enterEditMode(user)

    await user.click(screen.getByLabelText('include in total time'))

    await waitFor(() => expect(updateSet).toHaveBeenCalledWith(5, 10, { include_in_total: false }))
    expect(screen.getByText(/^Total/).textContent).toContain('0:00')
  })

  it('adds a pause and includes it in the total', async () => {
    addItem.mockResolvedValue({ id: 200, set_id: 10, item_type: 'pause', duration_seconds: 60, label: null, sort_order: 1 })
    const user = userEvent.setup()
    wrap()
    await screen.findByText('Creep')
    await enterEditMode(user)

    await user.click(screen.getByRole('button', { name: /add pause/i }))

    await waitFor(() => expect(addItem).toHaveBeenCalledWith(5, 10, { item_type: 'pause', duration_seconds: 60 }))
    await waitFor(() => expect(screen.getByText(/^Total/).textContent).toContain('2:40'))
  })

  it('shows a saved indicator after a change succeeds', async () => {
    const user = userEvent.setup()
    wrap()
    await screen.findByText('Creep')
    await enterEditMode(user)

    await user.click(screen.getByLabelText('include in total time'))

    await waitFor(() => expect(updateSet).toHaveBeenCalled())
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })

  it('toasts and reverts when a change fails', async () => {
    updateSet.mockRejectedValueOnce(new Error('nope'))
    const user = userEvent.setup()
    wrap()
    await screen.findByText('Creep')
    await enterEditMode(user)
    getSetlist.mockClear() // so we can assert the revert reload

    await user.click(screen.getByLabelText('include in total time'))

    expect(await screen.findByText('Failed to update set')).toBeInTheDocument()
    // The failed optimistic state is discarded by re-fetching the authoritative tree.
    await waitFor(() => expect(getSetlist).toHaveBeenCalledWith(5))
  })

  describe('print preview', () => {
    it('renders a Preview button', async () => {
      wrap()
      await screen.findByText('Creep')
      expect(screen.getByRole('button', { name: /preview/i })).toBeInTheDocument()
    })

    it('opens the preview modal when Preview is clicked', async () => {
      const user = userEvent.setup()
      wrap()
      await screen.findByText('Creep')

      await user.click(screen.getByRole('button', { name: /preview/i }))

      expect(await screen.findByRole('dialog')).toBeInTheDocument()
    })
  })

  describe('read-only mode', () => {
    it('hides edit/rearrange/move/delete affordances by default', async () => {
      wrap()
      await screen.findByText('Creep')

      // The view opens read-only: an Edit toggle, no editing controls.
      expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument()
      expect(screen.queryByLabelText('drag')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /delete item/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /add song/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /delete set$/i })).not.toBeInTheDocument()
      expect(screen.queryByLabelText('move set up')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('include in total time')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /add set/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /delete setlist/i })).not.toBeInTheDocument()
    })

    it('reveals the editing affordances after clicking Edit, and the toggle becomes Done', async () => {
      const user = userEvent.setup()
      wrap()
      await screen.findByText('Creep')
      await enterEditMode(user)

      expect(screen.getByRole('button', { name: /done/i })).toBeInTheDocument()
      expect(screen.getByLabelText('drag')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /add song/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /delete setlist/i })).toBeInTheDocument()
    })

    it('keeps the song note affordance visible and editable in read-only mode', async () => {
      saveItemNote.mockResolvedValue({ my_note: 'capo 2' })
      const user = userEvent.setup()
      wrap()
      await screen.findByText('Creep')
      // Still read-only — no Done button yet.
      expect(screen.queryByRole('button', { name: /done/i })).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'song note' }))
      await user.type(await screen.findByLabelText('song note text'), 'capo 2')
      await user.keyboard('{Escape}')

      await waitFor(() => expect(saveItemNote).toHaveBeenCalledWith(5, 100, 'capo 2'))
    })
  })

  describe('song notes', () => {
    it('saves a personal note from the song note popover', async () => {
      saveItemNote.mockResolvedValue({ my_note: 'capo 2' })
      const user = userEvent.setup()
      wrap()
      await screen.findByText('Creep')

      await user.click(screen.getByRole('button', { name: 'song note' }))
      await user.type(await screen.findByLabelText('song note text'), 'capo 2')
      await user.keyboard('{Escape}') // closing the popover persists the note

      await waitFor(() => expect(saveItemNote).toHaveBeenCalledWith(5, 100, 'capo 2'))
    })

    it('prefills the popover with an existing note', async () => {
      getSetlist.mockResolvedValue(treeWith([song(100, 'Creep', { my_note: 'drop D' })]))
      const user = userEvent.setup()
      wrap()
      await screen.findByText('Creep')

      await user.click(screen.getByRole('button', { name: 'song note' }))

      expect(await screen.findByLabelText('song note text')).toHaveValue('drop D')
    })
  })

  describe('song transitions', () => {
    it('links two consecutive songs via the chain affordance', async () => {
      getSetlist.mockResolvedValue(treeWith([song(100, 'Creep'), song(101, 'No Surprises')]))
      updateItem.mockResolvedValue({})
      const user = userEvent.setup()
      wrap()
      await screen.findByText('Creep')
      await enterEditMode(user)

      await user.click(screen.getByRole('button', { name: /link songs as transition/i }))

      await waitFor(() => expect(updateItem).toHaveBeenCalledWith(5, 100, { linked_to_next: true }))
    })

    it('saves a transition note on blur', async () => {
      getSetlist.mockResolvedValue(treeWith([
        song(100, 'Creep', { linked_to_next: true }),
        song(101, 'No Surprises'),
      ]))
      updateItem.mockResolvedValue({})
      const user = userEvent.setup()
      wrap()
      await screen.findByText('Creep')
      await enterEditMode(user)

      await user.type(screen.getByLabelText('transition note'), 'segue')
      await user.tab()

      await waitFor(() => expect(updateItem).toHaveBeenCalledWith(5, 100, { transition_note: 'segue' }))
    })

    it('clears the upper link when the follower is deleted (clearedIds)', async () => {
      getSetlist.mockResolvedValue(treeWith([
        song(100, 'Creep', { linked_to_next: true, transition_note: 'segue' }),
        song(101, 'No Surprises'),
        song(102, 'Karma Police'),
      ]))
      deleteItem.mockResolvedValue({ clearedIds: [100] })
      const user = userEvent.setup()
      wrap()
      await screen.findByText('Creep')
      await enterEditMode(user)
      // The linked strip (note field) is visible for the first pair.
      expect(screen.getByLabelText('transition note')).toBeInTheDocument()

      // Delete the middle song (the follower of the linked pair).
      await user.click(screen.getAllByRole('button', { name: /delete item/i })[1])

      await waitFor(() => expect(deleteItem).toHaveBeenCalledWith(5, 101))
      // Link cleared by the server's clearedIds → strip gone, only the add affordance remains.
      await waitFor(() => expect(screen.queryByLabelText('transition note')).not.toBeInTheDocument())
      expect(screen.getByRole('button', { name: /link songs as transition/i })).toBeInTheDocument()
    })
  })
})
