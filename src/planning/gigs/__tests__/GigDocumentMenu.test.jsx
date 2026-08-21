import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../gigs.ts', () => ({
  downloadGigArtistSettlement: vi.fn(),
  downloadGigItinerary: vi.fn(),
}))

vi.mock('../../../promotion/sharing/shareCard.ts', () => ({
  downloadBlob: vi.fn(),
}))

import GigDocumentMenu from '../components/gigdetails/GigDocumentMenu.tsx'
import { downloadGigArtistSettlement, downloadGigItinerary } from '../gigs.ts'
import { downloadBlob } from '../../../promotion/sharing/shareCard.ts'
import { ToastContext } from '../../../contexts/toastContext.ts'
import theme from '../../../theme.ts'

const GIG = { id: 7, event_description: 'Paradiso Night', event_date: '2026-09-12' }

function wrap(ui, { showToast } = {}) {
  return render(
    <ThemeProvider theme={theme}><MemoryRouter>
      <ToastContext.Provider value={showToast ?? null}>{ui}</ToastContext.Provider>
    </MemoryRouter></ThemeProvider>,
  )
}

function openMenu() {
  return userEvent.click(screen.getByLabelText('download gig documents'))
}

beforeEach(() => {
  vi.clearAllMocks()
  downloadGigItinerary.mockResolvedValue({
    blob: new Blob(['%PDF-'], { type: 'application/pdf' }),
    filename: 'itinerary-paradiso-night-09122026.pdf',
  })
  downloadGigArtistSettlement.mockResolvedValue({
    blob: new Blob(['%PDF-'], { type: 'application/pdf' }),
    filename: 'artist-settlement-paradiso-night-09122026.pdf',
  })
})

describe('GigDocumentMenu', () => {
  it('offers both generated PDFs to a finance viewer once the menu is open', async () => {
    wrap(<GigDocumentMenu gig={GIG} canViewFinance />)
    expect(screen.queryByText('Itinerary / Timetable')).not.toBeInTheDocument()
    expect(screen.queryByText('Artist settlement')).not.toBeInTheDocument()

    await openMenu()
    expect(screen.getByText('Itinerary / Timetable')).toBeInTheDocument()
    expect(screen.getByText('Artist settlement')).toBeInTheDocument()
  })

  it('keeps the finance-only settlement out of the menu for other members', async () => {
    wrap(<GigDocumentMenu gig={GIG} />)
    await openMenu()

    expect(screen.getByText('Itinerary / Timetable')).toBeInTheDocument()
    expect(screen.queryByText('Artist settlement')).not.toBeInTheDocument()
  })

  it('downloads the itinerary PDF for the gig in the reader\'s language', async () => {
    wrap(<GigDocumentMenu gig={GIG} />)
    await openMenu()
    await userEvent.click(screen.getByText('Itinerary / Timetable'))

    await waitFor(() => expect(downloadGigItinerary).toHaveBeenCalledTimes(1))
    expect(downloadGigItinerary).toHaveBeenCalledWith(7, expect.any(String))
    // The filename comes from the server's Content-Disposition, not the client.
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1))
    expect(downloadBlob.mock.calls[0][1]).toBe('itinerary-paradiso-night-09122026.pdf')
  })

  it('downloads the artist settlement PDF for the gig in the reader\'s language', async () => {
    wrap(<GigDocumentMenu gig={GIG} canViewFinance />)
    await openMenu()
    await userEvent.click(screen.getByText('Artist settlement'))

    await waitFor(() => expect(downloadGigArtistSettlement).toHaveBeenCalledWith(7, expect.any(String)))
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1))
    expect(downloadBlob.mock.calls[0][1]).toBe('artist-settlement-paradiso-night-09122026.pdf')
  })

  it('closes the menu after choosing a document', async () => {
    wrap(<GigDocumentMenu gig={GIG} />)
    await openMenu()
    await userEvent.click(screen.getByText('Itinerary / Timetable'))

    await waitFor(() => expect(screen.queryByText('Itinerary / Timetable')).not.toBeInTheDocument())
  })

  it('toasts instead of downloading when the request fails', async () => {
    const showToast = vi.fn()
    downloadGigItinerary.mockRejectedValue(new Error('boom'))
    wrap(<GigDocumentMenu gig={GIG} />, { showToast })

    await openMenu()
    await userEvent.click(screen.getByText('Itinerary / Timetable'))

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Downloading the itinerary failed', 'error'))
    expect(downloadBlob).not.toHaveBeenCalled()
  })

  it('does not request anything for a gig that has no id yet', async () => {
    wrap(<GigDocumentMenu gig={{}} />)
    await openMenu()
    await userEvent.click(screen.getByText('Itinerary / Timetable'))

    expect(downloadGigItinerary).not.toHaveBeenCalled()
  })
})
