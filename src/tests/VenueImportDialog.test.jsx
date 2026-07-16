import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import VenueImportDialog from '../components/VenueImportDialog.tsx'
import { importVenues } from '../api/venues.ts'
import theme from '../theme.ts'

vi.mock('../api/venues.ts', () => ({ importVenues: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
  importVenues.mockResolvedValue({ imported: 1, skipped: 0 })
})

describe('VenueImportDialog', () => {
  it('allows latitude and longitude columns to be mapped and imported', async () => {
    render(
      <ThemeProvider theme={theme}>
        <VenueImportDialog onClose={() => {}} />
      </ThemeProvider>,
    )
    const input = document.querySelector('input[type="file"]')
    await userEvent.upload(
      input,
      new File(['Name,Latitude,Longitude\nParadiso,52.3622,4.8838'], 'venues.csv', { type: 'text/csv' }),
    )

    expect(await screen.findByText('Latitude', { selector: 'label' })).toBeInTheDocument()
    expect(screen.getByText('Longitude', { selector: 'label' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Preview' }))
    await userEvent.click(screen.getByRole('button', { name: 'Import 1 row' }))

    await waitFor(() => expect(importVenues).toHaveBeenCalledTimes(1))
    expect(importVenues).toHaveBeenCalledWith([
      expect.objectContaining({ name: 'Paradiso', latitude: '52.3622', longitude: '4.8838' }),
    ])
  })
})
