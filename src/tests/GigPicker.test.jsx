import { render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/gigs.ts', () => ({
  listGigs: vi.fn(),
}))

import { listGigs } from '../api/gigs.ts'
import GigPicker from '../components/GigPicker.tsx'
import i18n from '../i18n/index.ts'
import theme from '../theme.ts'

afterEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
})

describe('GigPicker invoice UI', () => {
  it('renders its empty state in Dutch', async () => {
    listGigs.mockResolvedValue([])
    await i18n.changeLanguage('nl')

    render(
      <ThemeProvider theme={theme}>
        <GigPicker value={null} onChange={vi.fn()} />
      </ThemeProvider>,
    )

    expect(screen.getByLabelText('Optreden')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText('Nog geen optredens - maak er eerst een aan')).toBeInTheDocument()
    })
  })
})
