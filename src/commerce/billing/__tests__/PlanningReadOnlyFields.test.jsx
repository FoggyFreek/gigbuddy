import { render, screen, within } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { describe, expect, it, vi } from 'vitest'
import BandEventFields from '../../../planning/events/components/BandEventFields.tsx'
import RehearsalFields from '../../../planning/rehearsals/components/RehearsalFields.tsx'
import theme from '../../../theme.ts'

function wrap(node) {
  return render(
    <ThemeProvider theme={theme}>
      <LocalizationProvider dateAdapter={AdapterDayjs}>{node}</LocalizationProvider>
    </ThemeProvider>,
  )
}

describe('planning detail fields in reader mode', () => {
  it('renders rehearsal values as readable, read-only inputs', () => {
    wrap(
      <RehearsalFields
        form={{ proposed_date: '2026-07-10', location: 'Studio', start_time: '19:00', end_time: '21:00' }}
        onChange={vi.fn()}
        readOnly
        dateTimeFirst
      />,
    )

    const date = screen.getByLabelText(/^date/i)
    const location = screen.getByLabelText(/location/i)
    const startTime = screen.getByRole('group', { name: /start time/i })
    const endTime = screen.getByRole('group', { name: /end time/i })

    expect(date).toHaveAttribute('readonly')
    expect(location).toHaveAttribute('readonly')
    expect(date.closest('.MuiGrid-root')).toHaveClass('MuiGrid-grid-xs-12', 'MuiGrid-grid-sm-4')
    expect(startTime.closest('.MuiGrid-root')).toHaveClass('MuiGrid-grid-xs-6', 'MuiGrid-grid-sm-4')
    expect(endTime.closest('.MuiGrid-root')).toHaveClass('MuiGrid-grid-xs-6', 'MuiGrid-grid-sm-4')
    expect(location.closest('.MuiGrid-root')).toHaveClass('MuiGrid-grid-xs-12')
    expect(date.compareDocumentPosition(startTime) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(startTime.compareDocumentPosition(endTime) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(endTime.compareDocumentPosition(location) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    for (const section of within(startTime).getAllByRole('spinbutton')) {
      expect(section).toHaveAttribute('aria-readonly', 'true')
    }
  })

  it('renders band-event values as readable, read-only inputs', () => {
    wrap(
      <BandEventFields
        form={{
          title: 'Band meeting', start_date: '2026-07-10', end_date: '',
          start_time: '19:00', end_time: '20:00', location: 'Studio', notes: 'Bring ideas',
        }}
        onChange={vi.fn()}
        readOnly
      />,
    )

    expect(screen.getByLabelText(/title/i)).toHaveAttribute('readonly')
    expect(screen.getByLabelText(/location/i)).toHaveAttribute('readonly')
    expect(screen.getByLabelText(/notes/i)).toHaveAttribute('readonly')
  })
})
