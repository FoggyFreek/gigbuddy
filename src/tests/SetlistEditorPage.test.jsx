import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// dnd-kit measures with ResizeObserver, which jsdom lacks.
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

vi.mock('../api/setlists.ts', () => ({
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

vi.mock('../api/songs.ts', () => ({
  listSongs: vi.fn().mockResolvedValue([]),
}))

import SetlistEditorPage from '../pages/SetlistEditorPage.tsx'
import { addItem, deleteItem, getSetlist, saveItemNote, updateItem, updateSet } from '../api/setlists.ts'
import { ToastProvider } from '../contexts/ToastContext.tsx'
import theme from '../theme.ts'

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

async function enterEditMode(user) {
  await user.click(screen.getByRole('button', { name: /^edit$/i }))
}

function wrap() {
  return render(
    <MemoryRouter initialEntries={['/setlists/5']}>
      <ThemeProvider theme={theme}>
        <ToastProvider>
          <Routes>
            <Route path="/setlists/:id" element={<SetlistEditorPage />} />
          </Routes>
        </ToastProvider>
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
