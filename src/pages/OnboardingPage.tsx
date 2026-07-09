import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Link from '@mui/material/Link'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Step from '@mui/material/Step'
import StepLabel from '@mui/material/StepLabel'
import Stepper from '@mui/material/Stepper'
import Typography from '@mui/material/Typography'
import { TERMS_VERSION } from '../../shared/termsVersion.js'
import { useAuth } from '../contexts/authContext.ts'
import { acceptTerms, onboardingComplete } from '../api/auth.ts'
import {
  getBillingState,
  subscribe,
  syncSubscription,
  type BillingInterval,
  type SubscriptionPlan,
} from '../api/billing.ts'
import { createOwnedTenant, getTenantOnboardingStatus, listOwnedTenants } from '../api/tenants.ts'
import { uploadLogo } from '../api/profile.ts'
import type { Tenant } from '../types/entities.ts'
import WelcomeStep from '../components/onboarding/WelcomeStep.tsx'
import BandStep from '../components/onboarding/BandStep.tsx'
import SummaryStep from '../components/onboarding/SummaryStep.tsx'
import TermsDialog from '../components/onboarding/TermsDialog.tsx'

// Subscription states good enough to enter the app after checkout.
const SETTLED_STATUSES = ['trialing', 'active']
const POLL_ATTEMPTS = 10
const POLL_DELAY_MS = 3000

type CheckoutPhase = 'processing' | 'success' | 'timeout'

// Post-Mollie-checkout view: sync first (with webhooks disabled in local dev
// nothing else flips the status), then poll until the subscription settles.
function CheckoutReturn() {
  const { t } = useTranslation('onboarding')
  const navigate = useNavigate()
  const { refreshUser } = useAuth()
  const [phase, setPhase] = useState<CheckoutPhase>('processing')

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      for (let attempt = 0; attempt < POLL_ATTEMPTS && !cancelled; attempt++) {
        try {
          // Re-ingest on EVERY poll, not just once up front. With webhooks
          // disabled locally, sync is the only thing that advances a payment
          // that settles after we started polling — reading local state alone
          // would loop on a stale pending row and always time out.
          const { subscription } = await syncSubscription()
          const status = subscription?.status
          if (status && SETTLED_STATUSES.includes(status)) {
            // Best-effort: the user still enters the app if this fails. But it's
            // now requireCurrentTerms-gated, so a failure must not be invisible
            // — a swallowed error leaves a dangling onboarding_tenant_id that
            // would resurface the resume flow on a later /onboarding visit.
            await onboardingComplete().catch((err) => {
              console.error('[onboarding] onboardingComplete failed (checkout return)', err)
            })
            await refreshUser().catch(() => {})
            if (!cancelled) setPhase('success')
            return
          }
        } catch {
          // transient — keep polling
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_DELAY_MS))
      }
      if (!cancelled) setPhase('timeout')
    }
    void run()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Stack spacing={3} sx={{ alignItems: 'center', textAlign: 'center' }}>
      {phase === 'processing' && (
        <>
          <CircularProgress />
          <Typography variant="body1">{t($ => $.checkout.processing)}</Typography>
        </>
      )}
      {phase === 'success' && (
        <Alert severity="success" sx={{ width: '100%' }}>
          {t($ => $.checkout.success)}
        </Alert>
      )}
      {phase === 'timeout' && (
        <Alert severity="info" sx={{ width: '100%' }}>
          {t($ => $.checkout.timeout)}
        </Alert>
      )}
      {phase !== 'processing' && (
        <Button variant="contained" onClick={() => navigate('/')}>
          {t($ => $.checkout.enterApp)}
        </Button>
      )}
    </Stack>
  )
}

interface StepContentProps {
  activeStep: number
  ready: boolean
  loadError: boolean
  plans: SubscriptionPlan[]
  interval: BillingInterval
  onIntervalChange: (interval: BillingInterval) => void
  selectedPlanId: number | null
  onSelectPlan: (id: number | null) => void
  selectedPlan: SubscriptionPlan | null
  termsAgreed: boolean
  onTermsAgreedChange: (agreed: boolean) => void
  onOpenTerms: () => void
  bandName: string
  onBandNameChange: (name: string) => void
  onboardingTenant: Tenant | null
  logo: { file: File; previewUrl: string } | null
  onLogoFileChange: (file: File | null) => void
}

// The active wizard step (or the loading spinner before the wizard is ready).
function StepContent({
  activeStep, ready, loadError, plans, interval, onIntervalChange, selectedPlanId, onSelectPlan,
  selectedPlan, termsAgreed, onTermsAgreedChange, onOpenTerms, bandName, onBandNameChange,
  onboardingTenant, logo, onLogoFileChange,
}: Readonly<StepContentProps>) {
  if (!ready) {
    if (loadError) return null
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    )
  }
  if (activeStep === 0) {
    return (
      <WelcomeStep
        plans={plans}
        interval={interval}
        onIntervalChange={onIntervalChange}
        selectedPlanId={selectedPlanId}
        onSelectPlan={onSelectPlan}
        termsAgreed={termsAgreed}
        onTermsAgreedChange={onTermsAgreedChange}
        onOpenTerms={onOpenTerms}
      />
    )
  }
  if (activeStep === 1) {
    return (
      <BandStep
        bandName={bandName}
        onBandNameChange={onBandNameChange}
        resumedSlug={onboardingTenant?.slug ?? null}
        logoFile={logo?.file ?? null}
        logoPreviewUrl={logo?.previewUrl ?? null}
        onLogoFileChange={onLogoFileChange}
      />
    )
  }
  if (!selectedPlan) return null
  return (
    <SummaryStep
      plan={selectedPlan}
      interval={interval}
      bandName={bandName}
      resumedSlug={onboardingTenant?.slug ?? null}
      resumedBandName={onboardingTenant?.band_name ?? null}
      logoFileName={logo?.file.name ?? null}
    />
  )
}

interface WizardControlsProps {
  activeStep: number
  busy: boolean
  termsAgreed: boolean
  bandName: string
  selectedPlan: SubscriptionPlan | null
  onBack: () => void
  onWelcomeNext: () => void
  onGoSummary: () => void
  onConfirm: () => void
}

// Back/next row: per-step next label, gating, and dispatch.
function WizardControls({ activeStep, busy, termsAgreed, bandName, selectedPlan, onBack, onWelcomeNext, onGoSummary, onConfirm }: Readonly<WizardControlsProps>) {
  const { t } = useTranslation(['onboarding', 'common'])
  const paidSelected = Boolean(selectedPlan && !selectedPlan.is_fallback)

  const nextDisabled =
    busy ||
    (activeStep === 0 && (!termsAgreed || !selectedPlan)) ||
    (activeStep === 1 && bandName.trim() === '')

  const handleNext = () => {
    if (activeStep === 0) onWelcomeNext()
    else if (activeStep === 1) onGoSummary()
    else onConfirm()
  }

  const nextLabel = [
    paidSelected ? t($ => $.welcome.startTrial) : t($ => $.welcome.startFree),
    t($ => $.nextStep),
    paidSelected ? t($ => $.summary.confirmPaid) : t($ => $.summary.confirmFree),
  ][Math.min(activeStep, 2)]

  return (
    <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between' }}>
      <Button disabled={busy || activeStep === 0} onClick={onBack}>
        {t($ => $.common.actions.back)}
      </Button>
      <Button variant="contained" disabled={nextDisabled} onClick={handleNext}>
        {nextLabel}
      </Button>
    </Stack>
  )
}

export default function OnboardingPage() {
  const { t } = useTranslation(['onboarding', 'common'])
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { user, switchTenant, refreshUser } = useAuth()
  const checkoutReturn = params.get('checkout') === 'return'

  const [activeStep, setActiveStep] = useState(0)
  const [plans, setPlans] = useState<SubscriptionPlan[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [interval, setInterval] = useState<BillingInterval>('month')
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null)
  const [termsAgreed, setTermsAgreed] = useState(false)
  const [termsOpen, setTermsOpen] = useState(false)
  const [bandName, setBandName] = useState('')
  // File + its preview object URL, created/revoked in the change handler so
  // no render or effect ever mints URLs.
  const [logo, setLogo] = useState<{ file: File; previewUrl: string } | null>(null)
  const handleLogoFileChange = useCallback((file: File | null) => {
    setLogo((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl)
      return file ? { file, previewUrl: URL.createObjectURL(file) } : null
    })
  }, [])
  // The band this flow owns: either created in this session or recovered via
  // the server-side onboarding pointer — NEVER an arbitrary owned band.
  const [onboardingTenant, setOnboardingTenant] = useState<Tenant | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [capBlocked, setCapBlocked] = useState(false)
  const [tenantOnboardingEnabled, setTenantOnboardingEnabled] = useState<boolean | null>(null)
  // Whether the resume-pointer lookup has settled. The wizard must not become
  // interactive before this: proceeding while it's still in flight would let
  // handleConfirm see a null onboardingTenant and create ANOTHER band —
  // producing a false band-cap dead end (they already own the pointer band) or
  // a duplicate tenant. Starts true when there's no pointer to resolve.
  const [resumeChecked, setResumeChecked] = useState(false)
  // StrictMode double-effect guard for the mount loads.
  const loadedRef = useRef(false)

  const onboardingTenantId = user?.onboardingTenantId ?? null

  useEffect(() => {
    if (checkoutReturn || loadedRef.current) return
    loadedRef.current = true
    getTenantOnboardingStatus()
      .then((status) => setTenantOnboardingEnabled(status.tenantOnboardingEnabled))
      .catch(() => setLoadError(true))
    getBillingState()
      .then((state) => setPlans(state.plans.filter((p) => p.is_active)))
      .catch(() => setLoadError(true))
    if (onboardingTenantId !== null) {
      listOwnedTenants()
        .then((owned) => {
          const resumed = owned.find((o) => o.id === onboardingTenantId && !o.archived_at)
          if (resumed) {
            setOnboardingTenant(resumed)
            setBandName(resumed.band_name ?? '')
          }
          setResumeChecked(true)
        })
        // A failed lookup must NOT be swallowed: block the wizard rather than
        // let the user re-create a band they may already own.
        .catch(() => setLoadError(true))
    } else {
      setResumeChecked(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkoutReturn])

  const sortedPlans = useMemo(
    () => (plans ?? []).slice().sort((a, b) => a.sort_order - b.sort_order),
    [plans],
  )
  // The wizard is interactive only once BOTH the plans and the resume-pointer
  // lookup have settled — otherwise a resume user could act on incomplete state.
  const ready = plans !== null && resumeChecked && tenantOnboardingEnabled !== null
  const onboardingDisabled = tenantOnboardingEnabled === false && onboardingTenantId === null
  const selectedPlan = sortedPlans.find((p) => p.id === selectedPlanId) ?? null

  const stepLabels = [
    t($ => $.steps.welcome),
    t($ => $.steps.band),
    t($ => $.steps.summary),
  ]

  const handleWelcomeNext = useCallback(async () => {
    if (!termsAgreed || !selectedPlan) return
    setBusy(true)
    setError(null)
    try {
      // Skip the call when this exact version is already on record.
      if (user?.termsVersion !== TERMS_VERSION) {
        await acceptTerms(TERMS_VERSION)
      }
      setActiveStep(1)
    } catch {
      setError(t($ => $.errors.generic))
    } finally {
      setBusy(false)
    }
  }, [termsAgreed, selectedPlan, user?.termsVersion, t])

  // Create the onboarding band unless one was already created/resumed. Returns
  // null when a handled dead end (band cap / onboarding disabled) was shown.
  const ensureOnboardingTenant = useCallback(async (): Promise<Tenant | null> => {
    if (onboardingTenant) return onboardingTenant
    try {
      const tenant = await createOwnedTenant({ band_name: bandName.trim(), onboarding: true })
      setOnboardingTenant(tenant)
      return tenant
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code === 'band_limit_reached') {
        // Without a resume pointer this user already owns an unrelated
        // band — never adopt it; onboarding isn't the place to manage it.
        setCapBlocked(true)
        return null
      }
      if (code === 'tenant_onboarding_disabled') {
        setTenantOnboardingEnabled(false)
        setActiveStep(0)
        return null
      }
      throw err
    }
  }, [onboardingTenant, bandName])

  const handleConfirm = useCallback(async () => {
    if (!selectedPlan) return
    setBusy(true)
    setError(null)
    try {
      const tenant = await ensureOnboardingTenant()
      if (!tenant) return
      if (tenant.id !== undefined) await switchTenant(tenant.id)
      if (logo) {
        try {
          await uploadLogo(logo.file)
        } catch {
          setError(t($ => $.errors.logoUploadFailed)) // non-fatal, keep going
        }
      }
      if (selectedPlan.is_fallback) {
        // Best-effort (see CheckoutReturn): the free-plan user proceeds even if
        // this fails, but log it — a silently dangling onboarding_tenant_id
        // would re-trigger the resume flow next time they land on /onboarding.
        await onboardingComplete().catch((err) => {
          console.error('[onboarding] onboardingComplete failed (free plan)', err)
        })
        await refreshUser().catch(() => {})
        navigate('/')
        return
      }
      const { checkoutUrl } = await subscribe(selectedPlan.id, interval, 'onboarding')
      window.location.href = checkoutUrl
    } catch {
      setError(t($ => $.errors.generic))
    } finally {
      setBusy(false)
    }
  }, [selectedPlan, ensureOnboardingTenant, logo, interval, switchTenant, refreshUser, navigate, t])

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        bgcolor: 'background.default',
        px: 2,
        py: 4,
      }}
    >
      <Paper
        elevation={3}
        sx={{ p: 4, maxWidth: 760, width: '100%', display: 'flex', flexDirection: 'column', gap: 3 }}
      >
        <Stack spacing={1} sx={{ alignItems: 'center' }}>
          <Box
            component="img"
            src="/icons/gigbuddy_logo1.png"
            alt="GigBuddy"
            sx={{ height: 56 }}
          />
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            {t($ => $.welcome.title)}
          </Typography>
        </Stack>

        {checkoutReturn ? (
          <CheckoutReturn />
        ) : (
          <>
            <Stepper activeStep={activeStep} alternativeLabel>
              {stepLabels.map((label) => (
                <Step key={label}>
                  <StepLabel>{label}</StepLabel>
                </Step>
              ))}
            </Stepper>

            {loadError && <Alert severity="error">{t($ => $.errors.loadFailed)}</Alert>}
            {capBlocked ? (
              <Stack spacing={2}>
                <Alert severity="info">{t($ => $.errors.bandCapNoPointer)}</Alert>
                <Button variant="contained" onClick={() => navigate('/')}>
                  {t($ => $.checkout.enterApp)}
                </Button>
              </Stack>
            ) : onboardingDisabled ? (
              <Stack spacing={2}>
                <Alert severity="info">{t($ => $.errors.onboardingDisabled)}</Alert>
              </Stack>
            ) : (
              <>
                <StepContent
                  activeStep={activeStep}
                  ready={ready}
                  loadError={loadError}
                  plans={sortedPlans}
                  interval={interval}
                  onIntervalChange={setInterval}
                  selectedPlanId={selectedPlanId}
                  onSelectPlan={setSelectedPlanId}
                  selectedPlan={selectedPlan}
                  termsAgreed={termsAgreed}
                  onTermsAgreedChange={setTermsAgreed}
                  onOpenTerms={() => setTermsOpen(true)}
                  bandName={bandName}
                  onBandNameChange={setBandName}
                  onboardingTenant={onboardingTenant}
                  logo={logo}
                  onLogoFileChange={handleLogoFileChange}
                />

                {error && <Alert severity="error">{error}</Alert>}

                {ready && (
                  <WizardControls
                    activeStep={activeStep}
                    busy={busy}
                    termsAgreed={termsAgreed}
                    bandName={bandName}
                    selectedPlan={selectedPlan}
                    onBack={() => setActiveStep((s) => Math.max(0, s - 1))}
                    onWelcomeNext={() => { void handleWelcomeNext() }}
                    onGoSummary={() => setActiveStep(2)}
                    onConfirm={() => { void handleConfirm() }}
                  />
                )}
              </>
            )}

            {activeStep === 0 && !capBlocked && (
              <Link component={RouterLink} to="/redeem-invite" variant="body2" sx={{ alignSelf: 'center' }}>
                {t($ => $.welcome.haveInvite)}
              </Link>
            )}
          </>
        )}
      </Paper>

      <TermsDialog open={termsOpen} onClose={() => setTermsOpen(false)} />
    </Box>
  )
}
