import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../setlists.ts', () => ({
  listSetlists: vi.fn(),
  createSetlist: vi.fn(),
  copySetlist: vi.fn(),
}))

import SetlistsPage from '../SetlistsPage.tsx'
import { copySetlist, listSetlists } from '../setlists.ts'
import { DialogProvider } from '../../../contexts/DialogContext.tsx'
import { ToastProvider } from '../../../contexts/ToastContext.tsx'
import theme from '../../../theme.ts'
import { AuthContext } from '../../../contexts/authContext.ts'

// Super admin grants every planning.write capability, so the copy affordance is present.
const writerAuth = { user: { isSuperAdmin: true } }

const setlist = (id, name) => ({ id, name, set_count: 1, song_count: 3, total_seconds: 600 })

function wrap() {
  return render(
    <MemoryRouter initialEntries={['/setlists']}>
      <ThemeProvider theme={theme}>
        <AuthContext.Provider value={writerAuth}>
          <ToastProvider>
            <DialogProvider>
              <Routes>
                <Route path="/setlists" element={<SetlistsPage />} />
                <Route path="/setlists/:id" element={<div>editor</div>} />
              </Routes>
            </DialogProvider>
          </ToastProvider>
        </AuthContext.Provider>
      </ThemeProvider>
    </MemoryRouter>,
  )
}

describe('SetlistsPage copy', () => {
  beforeEach(() => {
    listSetlists.mockReset()
    listSetlists.mockResolvedValue([setlist(1, 'Main Set')])
    copySetlist.mockReset()
    copySetlist.mockResolvedValue(setlist(2, 'Main Set Copy'))
  })

  it('copies the setlist once confirmed and shows the new one', async () => {
    const user = userEvent.setup()
    wrap()
    await screen.findByText('Main Set')

    listSetlists.mockResolvedValue([setlist(1, 'Main Set'), setlist(2, 'Main Set Copy')])
    await user.click(screen.getByRole('button', { name: 'copy setlist Main Set' }))
    await user.click(await screen.findByRole('button', { name: 'Copy' }))

    await waitFor(() => expect(copySetlist).toHaveBeenCalledWith(1))
    expect(await screen.findByText('Main Set Copy')).toBeInTheDocument()
  })

  it('does not copy when the confirmation is cancelled', async () => {
    const user = userEvent.setup()
    wrap()
    await screen.findByText('Main Set')

    await user.click(screen.getByRole('button', { name: 'copy setlist Main Set' }))
    await user.click(await screen.findByRole('button', { name: /cancel/i }))

    await waitFor(() => expect(screen.queryByText('Copy this setlist?')).not.toBeInTheDocument())
    expect(copySetlist).not.toHaveBeenCalled()
  })

  it('opens the setlist when the card itself is clicked', async () => {
    const user = userEvent.setup()
    wrap()
    await user.click(await screen.findByText('Main Set'))
    expect(await screen.findByText('editor')).toBeInTheDocument()
  })
})
