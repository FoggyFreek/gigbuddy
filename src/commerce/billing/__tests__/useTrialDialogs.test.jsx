import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../billing.ts', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, getBillingState: vi.fn() }
})

import * as api from '../billing.ts'
import AppDialogs from '../../../dialogs/AppDialogs.tsx'
import { DialogProvider } from '../../../contexts/DialogContext.tsx'
import { AuthContext } from '../../../contexts/authContext.ts'
import { DIALOG_IDS } from '../../../dialogs/dialogRegistry.ts'
import { PERIOD_GRACE_MS } from '../../../auth/entitlements.ts'
import theme from '../../../theme.ts'
import '../../../i18n/index.ts'

const AUTH = { user: { id: 7 }, setUser: () => {}, logout: async () => {}, switchTenant: async () => {}, refreshUser: async () => {} }

const GRACE_TITLE = 'Your free trial is about to end'
const ENDED_TITLE = 'Your free trial has ended'

// A trial whose end date sits `agoMs` in the past, with nothing to convert it.
const lapsedTrial = (agoMs) => ({
  subscription: {
    status: 'trialing',
    convertedAt: null,
    paymentMethodReady: false,
    trialEndsAt: new Date(Date.now() - agoMs).toISOString(),
  },
  trialAvailable: false,
})

function wrap(auth = AUTH) {
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter>
        <AuthContext.Provider value={auth}>
          <DialogProvider>
            <AppDialogs />
          </DialogProvider>
        </AuthContext.Provider>
      </MemoryRouter>
    </ThemeProvider>,
  )
}

describe('useTrialDialogs', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.mocked(api.getBillingState).mockReset()
  })

  it('warns inside the grace window, while the modules still grant the trial', async () => {
    vi.mocked(api.getBillingState).mockResolvedValue(lapsedTrial(60 * 60 * 1000))
    wrap()
    expect(await screen.findByText(GRACE_TITLE)).toBeTruthy()
    expect(screen.queryByText(ENDED_TITLE)).toBeNull()
  })

  it('reports the ended trial once the grace window has closed', async () => {
    vi.mocked(api.getBillingState).mockResolvedValue(lapsedTrial(PERIOD_GRACE_MS + 60 * 1000))
    wrap()
    expect(await screen.findByText(ENDED_TITLE)).toBeTruthy()
    expect(screen.queryByText(GRACE_TITLE)).toBeNull()
  })

  it('reports the ended trial once the subscription is gone', async () => {
    vi.mocked(api.getBillingState).mockResolvedValue({ subscription: null, trialAvailable: false })
    wrap()
    expect(await screen.findByText(ENDED_TITLE)).toBeTruthy()
  })

  it('stays quiet while the trial is still running', async () => {
    vi.mocked(api.getBillingState).mockResolvedValue(lapsedTrial(-60 * 60 * 1000))
    wrap()
    await waitFor(() => expect(api.getBillingState).toHaveBeenCalled())
    expect(screen.queryByText(GRACE_TITLE)).toBeNull()
    expect(screen.queryByText(ENDED_TITLE)).toBeNull()
  })

  it('still asks when only one of the two prompts is suppressed', async () => {
    localStorage.setItem('gigbuddy_suppressed_dialogs', JSON.stringify([DIALOG_IDS.TRIAL_GRACE]))
    vi.mocked(api.getBillingState).mockResolvedValue({ subscription: null, trialAvailable: false })
    wrap()
    expect(await screen.findByText(ENDED_TITLE)).toBeTruthy()
  })

  it('asks nothing at all once both prompts are suppressed', async () => {
    localStorage.setItem(
      'gigbuddy_suppressed_dialogs',
      JSON.stringify([DIALOG_IDS.TRIAL_GRACE, DIALOG_IDS.TRIAL_ENDED]),
    )
    wrap()
    await Promise.resolve()
    expect(api.getBillingState).not.toHaveBeenCalled()
  })

  it('asks nothing for a signed-out visitor', async () => {
    wrap({ ...AUTH, user: null })
    await Promise.resolve()
    expect(api.getBillingState).not.toHaveBeenCalled()
  })
})
