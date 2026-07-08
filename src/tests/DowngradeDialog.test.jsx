import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api/billing.ts', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, downgradePreview: vi.fn() }
})

import * as api from '../api/billing.ts'
import DowngradeDialog from '../components/account/DowngradeDialog.tsx'
import theme from '../theme.ts'

const bronzePlan = {
  id: 1, slug: 'bronze', name: 'Bronze',
  monthly_price_cents: 0, yearly_price_cents: 0,
  entitlements: { features: {}, limits: { storage_mb: 50, members: 5, bands: 1 } },
  is_active: true, is_fallback: true, sort_order: 0,
}

function wrap(props = {}) {
  const onConfirm = vi.fn().mockResolvedValue(undefined)
  const onClose = vi.fn()
  render(
    <ThemeProvider theme={theme}>
      <DowngradeDialog
        open
        plan={bronzePlan}
        interval="month"
        isFreeFallback
        onClose={onClose}
        onConfirm={onConfirm}
        {...props}
      />
    </ThemeProvider>,
  )
  return { onConfirm, onClose }
}

const typePhrase = () =>
  fireEvent.change(screen.getByLabelText('downgrade confirmation phrase'), {
    target: { value: 'downgrade to bronze' },
  })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('DowngradeDialog preview', () => {
  it('fetches the preview on open and lists the data that will be deleted', async () => {
    api.downgradePreview.mockResolvedValue({
      isDowngrade: true, isFreeFallback: true,
      features: ['song_files', 'chordpro'],
      limitsSnapshot: { storage_mb: 50, members: 5, bands: 1 },
      blockers: [],
    })
    const { onConfirm } = wrap()

    expect(await screen.findByText('Song files')).toBeInTheDocument()
    expect(screen.getByText('Chord charts')).toBeInTheDocument()
    expect(api.downgradePreview).toHaveBeenCalledWith(bronzePlan.id, 'month')

    // Confirm stays disabled until the exact phrase is typed.
    const confirm = screen.getByRole('button', { name: 'Downgrade' })
    expect(confirm).toBeDisabled()
    typePhrase()
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('downgrade to bronze'))
  })

  it('shows the no-deletion note when the preview lists no purged features', async () => {
    api.downgradePreview.mockResolvedValue({
      isDowngrade: true, isFreeFallback: false, features: [], limitsSnapshot: {}, blockers: [],
    })
    wrap({ isFreeFallback: false })
    expect(await screen.findByText(/No stored data needs to be deleted/)).toBeInTheDocument()
  })

  it('blockers disable confirming even with a matching phrase', async () => {
    api.downgradePreview.mockResolvedValue({
      isDowngrade: true, isFreeFallback: true, features: [],
      limitsSnapshot: { storage_mb: 50 },
      blockers: [{ tenantId: 5, tenantName: 'Alpha Band', limit: 'storage_mb', current: 60, target: 50 }],
    })
    const { onConfirm } = wrap()

    expect(await screen.findByText(/Reduce usage before you can downgrade/)).toBeInTheDocument()
    expect(screen.getByText(/Alpha Band — Storage \(MB\): 60 \(allowed: 50\)/)).toBeInTheDocument()

    const confirm = screen.getByRole('button', { name: 'Downgrade' })
    expect(confirm).toBeDisabled()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('surfaces a preview load failure without blocking close', async () => {
    api.downgradePreview.mockRejectedValue(new Error('boom'))
    const { onClose } = wrap()
    expect(await screen.findByText(/Could not load the downgrade preview/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('a failed preview keeps confirming disabled even with a matching phrase', async () => {
    api.downgradePreview.mockRejectedValue(new Error('boom'))
    const { onConfirm } = wrap()
    expect(await screen.findByText(/Could not load the downgrade preview/)).toBeInTheDocument()
    typePhrase()
    expect(screen.getByRole('button', { name: 'Downgrade' })).toBeDisabled()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('confirm stays disabled while the preview is loading, then enables once it arrives', async () => {
    let resolvePreview
    api.downgradePreview.mockReturnValue(new Promise((resolve) => { resolvePreview = resolve }))
    wrap()
    typePhrase()
    expect(screen.getByRole('button', { name: 'Downgrade' })).toBeDisabled()

    resolvePreview({ isDowngrade: true, isFreeFallback: true, features: [], limitsSnapshot: {}, blockers: [] })
    expect(await screen.findByText(/No stored data needs to be deleted/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Downgrade' })).toBeEnabled()
  })
})
