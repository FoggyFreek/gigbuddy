import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import theme from '../theme.ts'
import FinanceOnboardingPage from '../pages/FinanceOnboardingPage.tsx'
import { getFinanceOnboardingStatus, setOpeningBalance } from '../api/financeOnboarding.ts'
import { getProfile, updateProfile, getMollieKey, getShopifySecret, getShopifyDomain, getShopifyClientId } from '../api/profile.ts'
import { listAccounts, getAccountingSettings } from '../api/accounts.ts'

vi.mock('../api/financeOnboarding.ts', () => ({
  getFinanceOnboardingStatus: vi.fn(),
  setOpeningBalance: vi.fn(),
}))
vi.mock('../api/profile.ts', () => ({
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
  // Read by the reused Mollie/Shopify integration cards on the integrations step.
  getMollieKey: vi.fn(),
  getShopifySecret: vi.fn(),
  getShopifyDomain: vi.fn(),
  getShopifyClientId: vi.fn(),
}))
vi.mock('../api/accounts.ts', () => ({
  listAccounts: vi.fn(),
  getAccountingSettings: vi.fn(),
  updateAccountingSettings: vi.fn(),
}))

function wrap(ui) {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>{ui}</ThemeProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  getFinanceOnboardingStatus.mockResolvedValue({ openingBalanceSet: false })
  getProfile.mockResolvedValue({})
  updateProfile.mockResolvedValue({})
  listAccounts.mockResolvedValue([])
  getAccountingSettings.mockResolvedValue({ currency: 'EUR' })
  setOpeningBalance.mockResolvedValue({ posted: true, transactionId: 1 })
  getMollieKey.mockResolvedValue({ isSet: false, changedAt: null })
  getShopifySecret.mockResolvedValue({ isSet: false, changedAt: null })
  getShopifyDomain.mockResolvedValue({ domain: null })
  getShopifyClientId.mockResolvedValue({ clientId: null })
})

describe('FinanceOnboardingPage', () => {
  it('posts a manual opening balance (parsed to signed cents) on advancing', async () => {
    wrap(<FinanceOnboardingPage />)
    const user = userEvent.setup()

    // Welcome → opening balance.
    expect(await screen.findByText('Set up your finances')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByText('Tell gigBuddy how much was in your bank account when you start keeping books here.')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Bank balance'), '1.250,50')
    await user.click(screen.getByRole('button', { name: 'Next' }))

    await waitFor(() => expect(setOpeningBalance).toHaveBeenCalledTimes(1))
    const arg = setOpeningBalance.mock.calls[0][0]
    expect(arg.amountCents).toBe(125050)
    expect(arg.entryDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('skips posting when the user chooses to set it later', async () => {
    wrap(<FinanceOnboardingPage />)
    const user = userEvent.setup()
    await screen.findByText('Set up your finances')
    await user.click(screen.getByRole('button', { name: 'Next' }))

    await user.click(await screen.findByRole('radio', { name: 'Set it later from a bank statement' }))
    // The action button becomes a skip; advancing must not post.
    await user.click(screen.getByRole('button', { name: 'Skip for now' }))

    await waitFor(() => expect(screen.getByText('Used on your invoices and tax filings. You can edit this later on your profile page.')).toBeInTheDocument())
    expect(setOpeningBalance).not.toHaveBeenCalled()
  })

  it('shows the already-set notice and does not re-post when a balance exists', async () => {
    getFinanceOnboardingStatus.mockResolvedValue({ openingBalanceSet: true })
    wrap(<FinanceOnboardingPage />)
    const user = userEvent.setup()
    await screen.findByText('Set up your finances')
    await user.click(screen.getByRole('button', { name: 'Next' }))

    expect(await screen.findByText('An opening balance is already set for this band.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(screen.getByText('Used on your invoices and tax filings. You can edit this later on your profile page.')).toBeInTheDocument())
    expect(setOpeningBalance).not.toHaveBeenCalled()
  })

  it('shows the Mollie and Shopify integration options on the integrations step', async () => {
    wrap(<FinanceOnboardingPage />)
    const user = userEvent.setup()
    await screen.findByText('Set up your finances')

    // welcome → opening balance (skip) → profile → integrations
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(await screen.findByRole('radio', { name: 'Set it later from a bank statement' }))
    await user.click(screen.getByRole('button', { name: 'Skip for now' }))
    await user.click(await screen.findByRole('button', { name: 'Next' })) // profile → integrations

    expect(await screen.findByText('Connect Mollie and Shopify')).toBeInTheDocument()
    expect(screen.getByAltText('Mollie')).toBeInTheDocument()
    expect(screen.getByAltText('Shopify')).toBeInTheDocument()
  })
})
