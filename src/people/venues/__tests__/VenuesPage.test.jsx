import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it, vi } from 'vitest'
import { DialogProvider } from '../../../contexts/DialogContext.tsx'
import theme from '../../../theme.ts'
import VenuesPage from '../VenuesPage.tsx'
import { listVenues } from '../venues.ts'

vi.mock('../venues.ts', () => ({ listVenues: vi.fn() }))
vi.mock('../../../components/SplitView.tsx', () => ({ default: ({ children }) => children }))
vi.mock('../components/VenuesTable.tsx', () => ({
  default: ({ venues, onEmailSelected }) => (
    <button type="button" onClick={() => onEmailSelected(venues)}>Email selected</button>
  ),
}))
vi.mock('../components/VenueFormModal.tsx', () => ({ default: () => null }))
vi.mock('../components/VenueImportDialog.tsx', () => ({ default: () => null }))
vi.mock('../../../promotion/outreach/components/VenueCampaignDialogContent.tsx', () => ({
  default: () => <div>Venue campaign dialog body</div>,
}))

describe('VenuesPage email campaign', () => {
  it('opens the selected venues in the shared dialog instead of navigating to a composer page', async () => {
    listVenues.mockResolvedValue([{ id: 1, name: 'Test Venue', email: 'venue@example.com' }])
    const user = userEvent.setup()
    render(
      <ThemeProvider theme={theme}>
        <MemoryRouter initialEntries={['/venues']}>
          <DialogProvider>
            <Routes>
              <Route path="/venues" element={<VenuesPage />} />
              <Route path="/outreach/compose" element={<div>Composer page</div>} />
            </Routes>
          </DialogProvider>
        </MemoryRouter>
      </ThemeProvider>,
    )

    await user.click(await screen.findByRole('button', { name: 'Email selected' }))
    expect(await screen.findByRole('dialog', { name: 'Email selected venues' })).toBeInTheDocument()
    expect(screen.getByText('Venue campaign dialog body')).toBeInTheDocument()
    expect(screen.queryByText('Composer page')).not.toBeInTheDocument()
  })
})
