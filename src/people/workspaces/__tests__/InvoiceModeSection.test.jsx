import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthContext } from '../../../contexts/authContext.ts'
import InvoiceModeSection from '../components/settings/InvoiceModeSection.tsx'
import theme from '../../../theme.ts'

vi.mock('../tenants.ts', () => ({
  getTenantInvoiceMode: vi.fn(),
  updateTenantInvoiceMode: vi.fn(),
}))

import { getTenantInvoiceMode, updateTenantInvoiceMode } from '../tenants.ts'

function wrap(role = 'financial_admin') {
  const user = { activeTenantId: 1, activeTenantRole: role, isSuperAdmin: false }
  return render(
    <AuthContext.Provider value={{ user }}>
      <ThemeProvider theme={theme}><InvoiceModeSection /></ThemeProvider>
    </AuthContext.Provider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  getTenantInvoiceMode.mockResolvedValue({ preferred_invoice_mode: 'combined' })
  updateTenantInvoiceMode.mockImplementation(async (mode) => ({ preferred_invoice_mode: mode }))
})

describe('InvoiceModeSection', () => {
  it('renders both modes and the worked example', async () => {
    wrap()

    expect(await screen.findByRole('radio', { name: /combined/i })).toBeChecked()
    expect(screen.getByRole('radio', { name: /specified/i })).not.toBeChecked()
    expect(screen.getByText(/€850 artist fee \+ €150 booking fee/i)).toBeInTheDocument()
    expect(screen.getByText(/total remains €1,000/i)).toBeInTheDocument()
  })

  it('persists a selected mode', async () => {
    const user = userEvent.setup()
    wrap()

    await user.click(await screen.findByRole('radio', { name: /specified/i }))
    await waitFor(() => expect(updateTenantInvoiceMode).toHaveBeenCalledWith('specified'))
    expect(screen.getByRole('radio', { name: /specified/i })).toBeChecked()
  })

  it('disables editing without finance.manage', async () => {
    wrap('contributor')

    expect(await screen.findByRole('radio', { name: /combined/i })).toBeDisabled()
    expect(screen.getByRole('radio', { name: /specified/i })).toBeDisabled()
  })
})
