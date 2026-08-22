import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../commerce/billing/billing.ts', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, downgradePreview: vi.fn() }
})

import * as api from '../../commerce/billing/billing.ts'
import DowngradeDialog from '../../finance/accounts/components/DowngradeDialog.tsx'
import theme from '../../theme.ts'

const silverPlan = {
  id: 2, slug: 'silver', name: 'Silver', audience: 'band',
  monthly_price_cents: 999, yearly_price_cents: 9999,
  entitlements: { features: {}, limits: { storage_mb: 150, members: null, bands: 3 } },
  is_active: true, is_fallback: false, is_trial_tier: false, sort_order: 2,
}

const emptyPreview = (over = {}) => ({
  isDowngrade: true, isRemoval: false, features: [], limitsSnapshot: {},
  blockers: [], nextSnapshot: null, effectiveAt: null, ...over,
})

// The dialog is the informed-consent gate for the one flow that deletes data,
// so every case here is about what the user must have SEEN before confirm works.
function wrap(props = {}) {
  const onConfirm = vi.fn().mockResolvedValue(undefined)
  const onClose = vi.fn()
  render(
    <ThemeProvider theme={theme}>
      <DowngradeDialog
        open
        audience="band"
        plan={silverPlan}
        isTrial={false}
        onClose={onClose}
        onConfirm={onConfirm}
        {...props}
      />
    </ThemeProvider>,
  )
  return { onConfirm, onClose }
}

const typePhrase = (phrase = 'downgrade to silver') =>
  fireEvent.change(screen.getByLabelText('confirmation phrase'), { target: { value: phrase } })

const confirmButton = () => screen.getByRole('button', { name: 'Confirm' })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('DowngradeDialog — lowering a module', () => {
  it('fetches the preview on open and lists the data that will be deleted', async () => {
    api.downgradePreview.mockResolvedValue(emptyPreview({
      features: ['song_files', 'chordpro'],
      limitsSnapshot: { storage_mb: 150 },
    }))
    const { onConfirm } = wrap()

    expect(await screen.findByText('Song files')).toBeInTheDocument()
    expect(screen.getByText('Chord charts')).toBeInTheDocument()
    expect(api.downgradePreview).toHaveBeenCalledWith({ audience: 'band', planId: silverPlan.id })

    // Confirm stays disabled until the exact phrase is typed.
    expect(confirmButton()).toBeDisabled()
    typePhrase()
    expect(confirmButton()).toBeEnabled()
    fireEvent.click(confirmButton())
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('downgrade to silver'))
  })

  it('says when the change takes effect, so nobody expects it now', async () => {
    api.downgradePreview.mockResolvedValue(emptyPreview({
      effectiveAt: '2027-05-01T00:00:00.000Z',
    }))
    wrap()
    expect(await screen.findByText(/takes effect on/)).toBeInTheDocument()
  })

  it('says a trial change is immediate instead', async () => {
    api.downgradePreview.mockResolvedValue(emptyPreview({ effectiveAt: null }))
    wrap({ isTrial: true })
    expect(await screen.findByText(/takes effect immediately/)).toBeInTheDocument()
  })

  it('shows what the subscription will cost afterwards', async () => {
    api.downgradePreview.mockResolvedValue(emptyPreview({
      nextSnapshot: {
        modules: { band: { plan: 'silver', priceCents: 999 } },
        subtotalCents: 999, discounts: [], totalCents: 999,
      },
    }))
    wrap()
    expect(await screen.findByText(/becomes/)).toBeInTheDocument()
  })

  it('shows the no-deletion note when the preview lists no purged features', async () => {
    api.downgradePreview.mockResolvedValue(emptyPreview())
    wrap()
    expect(await screen.findByText(/No stored data needs to be deleted/)).toBeInTheDocument()
  })

  it('blockers disable confirming even with a matching phrase', async () => {
    api.downgradePreview.mockResolvedValue(emptyPreview({
      blockers: [{ tenantId: 5, tenantName: 'Alpha Band', limit: 'storage_mb', current: 60, target: 50 }],
    }))
    const { onConfirm } = wrap()

    expect(await screen.findByText(/Reduce usage before you can continue/)).toBeInTheDocument()
    expect(screen.getByText(/Alpha Band — Storage \(MB\): 60 \(allowed: 50\)/)).toBeInTheDocument()

    expect(confirmButton()).toBeDisabled()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('surfaces a preview load failure without blocking close', async () => {
    api.downgradePreview.mockRejectedValue(new Error('boom'))
    const { onClose } = wrap()
    expect(await screen.findByText(/Could not load the preview/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('a failed preview keeps confirming disabled even with a matching phrase', async () => {
    api.downgradePreview.mockRejectedValue(new Error('boom'))
    const { onConfirm } = wrap()
    expect(await screen.findByText(/Could not load the preview/)).toBeInTheDocument()
    typePhrase()
    expect(confirmButton()).toBeDisabled()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('confirm stays disabled while the preview is loading, then enables once it arrives', async () => {
    let resolvePreview
    api.downgradePreview.mockReturnValue(new Promise((resolve) => { resolvePreview = resolve }))
    wrap()
    typePhrase()
    expect(confirmButton()).toBeDisabled()

    resolvePreview(emptyPreview())
    expect(await screen.findByText(/No stored data needs to be deleted/)).toBeInTheDocument()
    expect(confirmButton()).toBeEnabled()
  })
})

describe('DowngradeDialog — removing a module', () => {
  it('previews the removal and demands its own phrase', async () => {
    api.downgradePreview.mockResolvedValue(emptyPreview({
      isRemoval: true, features: ['chordpro'],
    }))
    const { onConfirm } = wrap({ plan: null })

    expect(await screen.findByText('Chord charts')).toBeInTheDocument()
    expect(api.downgradePreview).toHaveBeenCalledWith({ audience: 'band', remove: true })

    // The downgrade phrase must not unlock a removal.
    typePhrase('downgrade to silver')
    expect(confirmButton()).toBeDisabled()

    typePhrase('remove band')
    expect(confirmButton()).toBeEnabled()
    fireEvent.click(confirmButton())
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('remove band'))
  })
})
