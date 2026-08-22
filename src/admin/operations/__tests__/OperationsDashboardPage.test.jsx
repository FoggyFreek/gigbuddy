import { render, screen } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import OperationsDashboardPage from '../OperationsDashboardPage.tsx'
import { getOperationsSummary } from '../adminOperations.ts'
import theme from '../../../theme.ts'

vi.mock('../adminOperations.ts', () => ({ getOperationsSummary: vi.fn() }))

describe('OperationsDashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getOperationsSummary.mockResolvedValue({
      terminalOperations: 2,
      retryingOperations: 3,
      pendingOperations: 4,
      oldestPendingAt: '2026-08-16T10:00:00.000Z',
      unresolvedWebhookFailures: 5,
      statusDrift: 6,
    })
  })

  it('shows actionable alert counts with links to each detail page', async () => {
    render(
      <MemoryRouter>
        <ThemeProvider theme={theme}><OperationsDashboardPage /></ThemeProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: 'Operations dashboard' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Terminal operations/ })).toHaveAttribute('href', '/admin/operations/billing')
    expect(screen.getByRole('link', { name: /Webhook failures/ })).toHaveAttribute('href', '/admin/operations/webhooks')
    expect(screen.getByRole('link', { name: /Status drift/ })).toHaveAttribute('href', '/admin/operations/status')
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('6')).toBeInTheDocument()
  })
})
