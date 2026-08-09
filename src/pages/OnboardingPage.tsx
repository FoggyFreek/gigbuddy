import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Link from '@mui/material/Link'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Step from '@mui/material/Step'
import MuiStepContent from '@mui/material/StepContent'
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
import {
  createOwnedTenant,
  createPersonalTenant,
  getTenantOnboardingStatus,
  listOwnedTenants,
} from '../api/tenants.ts'
import { uploadLogo } from '../api/profile.ts'
import { requestClaim } from '../api/bandProfileClaims.ts'
import { useCompactLayout } from '../hooks/useCompactLayout.ts'
import type { BandProfile, Tenant } from '../types/entities.ts'
import type { TenantKind } from '../utils/businessRegistry.ts'
import { ladderPlans } from '../utils/planLadder.ts'
import { audienceForTenantKind, isPlanAudience } from '../auth/planAudiences.ts'
import type { PlanAudience } from '../auth/planAudiences.ts'
import WelcomeStep from '../components/onboarding/WelcomeStep.tsx'
import BandStep from '../components/onboarding/BandStep.tsx'
import ClaimBandProfileField from '../components/onboarding/ClaimBandProfileField.tsx'
import SummaryStep from '../components/onboarding/SummaryStep.tsx'
import TermsDialog from '../components/onboarding/TermsDialog.tsx'

// Subscription states good enough to enter the app after checkout.
const SETTLED_STATUSES = ['trialing', 'active']
const POLL_ATTEMPTS = 10
const POLL_DELAY_MS = 3000

type CheckoutPhase = 'processing' | 'success' | 'timeout'

// Post-Mollie-checkout view: sync first (with webhooks disabled in local dev
// nothing else flips the status), then poll until the subscription settles.
function CheckoutReturn({ audience }: Readonly<{ audience: PlanAudience | null }>) {
  const { t } = useTranslation('onboarding')
  const navigate = useNavigate()
  const { refreshUser } = useAuth()
  const [phase, setPhase] = useState<CheckoutPhase>(() => audience === null ? 'timeout' : 'processing')

  useEffect(() => {
    // Without a named product we cannot tell which subscription this checkout
    // was for, and a settled one on the other ladder would read as success.
    // Better to time out and let the webhook/scheduler finish the job.
    if (audience === null) return undefined
    let cancelled = false
    const run = async () => {
      for (let attempt = 0; attempt < POLL_ATTEMPTS && !cancelled; attempt++) {
        try {
          // Re-ingest on EVERY poll, not just once up front. With webhooks
          // disabled locally, sync is the only thing that advances a payment
          // that settles after we started polling — reading local state alone
          // would loop on a stale pending row and always time out.
          const { subscriptions } = await syncSubscription(audience)
          const status = subscriptions[audience]?.status
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
  claimProfile: BandProfile | null
  onClaimProfileChange: (profile: BandProfile | null) => void
  activeStep: number
  kind: TenantKind
  onKindChange: (kind: TenantKind) => void
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
  countryCode: string
  onCountryCodeChange: (code: string) => void
  onboardingTenant: Tenant | null
  logo: { file: File; previewUrl: string } | null
  onLogoFileChange: (file: File | null) => void
}

// The active wizard step (or the loading spinner before the wizard is ready).
function StepContent({
  activeStep, kind, onKindChange, ready, loadError, plans, interval, onIntervalChange,
  selectedPlanId, onSelectPlan,
  selectedPlan, termsAgreed, onTermsAgreedChange, onOpenTerms, bandName, onBandNameChange,
  countryCode, onCountryCodeChange, onboardingTenant, logo, onLogoFileChange,
  claimProfile, onClaimProfileChange,
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
        kind={kind}
        onKindChange={onKindChange}
        // The kind is fixed once the tenant exists — a resumed onboarding
        // continues the kind it started, read off the resumed tenant.
        showKindChoice={onboardingTenant === null}
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
      <Stack spacing={3}>
        <BandStep
          kind={kind}
          bandName={bandName}
          onBandNameChange={onBandNameChange}
          countryCode={countryCode}
          onCountryCodeChange={onCountryCodeChange}
          resumedSlug={onboardingTenant?.slug ?? null}
          logoFile={logo?.file ?? null}
          logoPreviewUrl={logo?.previewUrl ?? null}
          onLogoFileChange={onLogoFileChange}
        />
        {/* Band workspaces only: a personal workspace has no profile to claim. */}
        {kind === 'band' && (
          <ClaimBandProfileField selected={claimProfile} onChange={onClaimProfileChange} />
        )}
      </Stack>
    )
  }
  if (!selectedPlan) return null
  return (
    <SummaryStep
      kind={kind}
      plan={selectedPlan}
      interval={interval}
      bandName={bandName}
      resumedSlug={onboardingTenant?.slug ?? null}
      resumedBandName={onboardingTenant?.display_name ?? onboardingTenant?.band_name ?? null}
      logoFileName={logo?.file.name ?? null}
    />
  )
}

interface WizardControlsProps {
  activeStep: number
  kind: TenantKind
  busy: boolean
  termsAgreed: boolean
  bandName: string
  countryCode: string
  selectedPlan: SubscriptionPlan | null
  onBack: () => void
  onWelcomeNext: () => void
  onGoSummary: () => void
  onConfirm: () => void
}

// Back/next row: per-step next label, gating, and dispatch.
function WizardControls({ activeStep, kind, busy, termsAgreed, bandName, countryCode, selectedPlan, onBack, onWelcomeNext, onGoSummary, onConfirm }: Readonly<WizardControlsProps>) {
  const { t } = useTranslation(['onboarding', 'common'])
  const paidSelected = Boolean(selectedPlan && !selectedPlan.is_fallback)

  const nextDisabled =
    busy ||
    (activeStep === 0 && (!termsAgreed || !selectedPlan)) ||
    (activeStep === 1 && (bandName.trim() === '' || countryCode === ''))

  const handleNext = () => {
    if (activeStep === 0) onWelcomeNext()
    else if (activeStep === 1) onGoSummary()
    else onConfirm()
  }

  const nextLabel = [
    paidSelected ? t($ => $.welcome.startTrial) : t($ => $.welcome.startFree),
    t($ => $.nextStep),
    paidSelected ? t($ => $.summary.confirmPaid) : t($ => $.workspace[kind].confirmFree),
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
  const isCompact = useCompactLayout()
  const checkoutReturn = params.get('checkout') === 'return'
  // Which product the checkout was for — the mandate redirect carries it, so
  // polling watches that ladder alone.
  const audienceParam = params.get('audience')
  const checkoutAudience = isPlanAudience(audienceParam) ? audienceParam : null

  const [activeStep, setActiveStep] = useState(0)
  const [plans, setPlans] = useState<SubscriptionPlan[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [interval, setInterval] = useState<BillingInterval>('month')
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null)
  const [termsAgreed, setTermsAgreed] = useState(false)
  const [termsOpen, setTermsOpen] = useState(false)
  const [bandName, setBandName] = useState('')
  // Which sort of tenant this flow creates. A band by default; the choice is
  // offered on step 1 and is fixed once the tenant exists.
  const [kind, setKind] = useState<TenantKind>('band')
  // No default: the accounting country must be chosen, not inherited.
  const [countryCode, setCountryCode] = useState('')
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
  const onboardingTenantId = user?.onboardingTenantId ?? null
  // Whether the resume-pointer lookup has settled. The wizard must not become
  // interactive before this: proceeding while it's still in flight would let
  // handleConfirm see a null onboardingTenant and create ANOTHER band —
  // producing a false band-cap dead end (they already own the pointer band) or
  // a duplicate tenant. Starts true when there's no pointer to resolve.
  const [resumeLookupComplete, setResumeLookupComplete] = useState(false)
  const resumeChecked = onboardingTenantId === null || resumeLookupComplete
  // StrictMode double-effect guard for the mount loads.
  const loadedRef = useRef(false)

  useEffect(() => {
    if (checkoutReturn || loadedRef.current) return
    loadedRef.current = true
    getTenantOnboardingStatus()
      .then((status) => {
        if (!status.tenantOnboardingEnabled && onboardingTenantId === null) {
          navigate('/redeem-invite', { replace: true })
          return
        }
        setTenantOnboardingEnabled(status.tenantOnboardingEnabled)
      })
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
            setBandName(resumed.display_name ?? resumed.band_name ?? '')
            setCountryCode(resumed.accounting_country ?? '')
            setKind(resumed.kind ?? 'band')
          }
          setResumeLookupComplete(true)
        })
        // A failed lookup must NOT be swallowed: block the wizard rather than
        // let the user re-create a band they may already own.
        .catch(() => setLoadError(true))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkoutReturn])

  // Only the ladder the chosen workspace kind is billed on: a band is priced on
  // the band plans, an artist workspace on the artist plans, and there is no
  // path between them.
  const sortedPlans = useMemo(
    () => ladderPlans(plans ?? [], audienceForTenantKind(kind), { activeOnly: true }),
    [plans, kind],
  )

  // Switching kind switches product, so a plan picked on the other ladder is no
  // longer a valid choice.
  const handleKindChange = useCallback((next: TenantKind) => {
    setKind(next)
    setSelectedPlanId(null)
  }, [])
  // The wizard is interactive only once BOTH the plans and the resume-pointer
  // lookup have settled — otherwise a resume user could act on incomplete state.
  const ready = plans !== null && resumeChecked && tenantOnboardingEnabled !== null
  const onboardingDisabled = tenantOnboardingEnabled === false && onboardingTenantId === null
  const selectedPlan = sortedPlans.find((p) => p.id === selectedPlanId) ?? null

  const stepLabels = [
    t($ => $.steps.welcome),
    t($ => $.workspace[kind].step),
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
  }, [termsAgreed, selectedPlan, user, t])

  // Create the onboarding band unless one was already created/resumed. Returns
  // null when a handled dead end (band cap / onboarding disabled) was shown.
  const ensureOnboardingTenant = useCallback(async (): Promise<Tenant | null> => {
    if (onboardingTenant) return onboardingTenant
    try {
      // Both kinds create an owned tenant with the same resume pointer; only
      // the service call differs. Personal creation is idempotent server-side.
      const tenant = kind === 'personal'
        ? await createPersonalTenant({
          display_name: bandName.trim(), country_code: countryCode, onboarding: true,
        })
        : await createOwnedTenant({
          band_name: bandName.trim(), country_code: countryCode, onboarding: true,
        })
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
        navigate('/redeem-invite', { replace: true })
        return null
      }
      throw err
    }
  }, [onboardingTenant, kind, bandName, countryCode, navigate])

  // Carried as wizard state and submitted only once the workspace exists.
  const [claimProfile, setClaimProfile] = useState<BandProfile | null>(null)

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
      // After the switch, not as a payload field on tenant creation: a resumed
      // onboarding short-circuits ensureOnboardingTenant, so a claim carried in
      // that call would be silently skipped for exactly the people most likely
      // to have been interrupted. Non-fatal for the same reason as the logo — a
      // rejectable, offline-verified request must never kill workspace creation.
      if (claimProfile) {
        try {
          await requestClaim(claimProfile.id)
        } catch {
          setError(t($ => $.errors.claimFailed))
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
  }, [selectedPlan, ensureOnboardingTenant, logo, claimProfile, interval, switchTenant, refreshUser, navigate, t])

  const loadErrorAlert = loadError && (
    <Alert severity="error">{t($ => $.errors.loadFailed)}</Alert>
  )

  // The interactive wizard: active step body, error, and the back/next row.
  const wizardBody = (
    <>
      <StepContent
        activeStep={activeStep}
        kind={kind}
        onKindChange={handleKindChange}
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
        countryCode={countryCode}
        onCountryCodeChange={setCountryCode}
        onboardingTenant={onboardingTenant}
        logo={logo}
        onLogoFileChange={handleLogoFileChange}
        claimProfile={claimProfile}
        onClaimProfileChange={setClaimProfile}
      />

      {error && <Alert severity="error">{error}</Alert>}

      {ready && (
        <WizardControls
          activeStep={activeStep}
          kind={kind}
          busy={busy}
          termsAgreed={termsAgreed}
          bandName={bandName}
          countryCode={countryCode}
          selectedPlan={selectedPlan}
          onBack={() => setActiveStep((s) => Math.max(0, s - 1))}
          onWelcomeNext={() => { void handleWelcomeNext() }}
          onGoSummary={() => setActiveStep(2)}
          onConfirm={() => { void handleConfirm() }}
        />
      )}
    </>
  )

  // A handled dead end (band cap / onboarding disabled) replaces the wizard.
  const bodyRegion = capBlocked ? (
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
    wizardBody
  )

  const haveInviteLink = activeStep === 0 && !capBlocked && (
    <Link component={RouterLink} to="/redeem-invite" variant="body2" sx={{ alignSelf: 'center' }}>
      {t($ => $.welcome.haveInvite)}
    </Link>
  )

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
          <CheckoutReturn audience={checkoutAudience} />
        ) : isCompact ? (
          // Compact: nest the active step's body + controls inside its
          // StepContent so the wizard doesn't stack three tall labels.
          <>
            <Stepper activeStep={activeStep} orientation="vertical">
              {stepLabels.map((label, index) => (
                <Step key={label}>
                  <StepLabel>{label}</StepLabel>
                  <MuiStepContent>
                    {index === activeStep && (
                      <>
                        {loadErrorAlert}
                        {bodyRegion}
                      </>
                    )}
                  </MuiStepContent>
                </Step>
              ))}
            </Stepper>

            {haveInviteLink}
          </>
        ) : (
          <>
            <Stepper activeStep={activeStep} alternativeLabel>
              {stepLabels.map((label) => (
                <Step key={label}>
                  <StepLabel>{label}</StepLabel>
                </Step>
              ))}
            </Stepper>

            {loadErrorAlert}
            {bodyRegion}
            {haveInviteLink}
          </>
        )}
      </Paper>

      <TermsDialog open={termsOpen} onClose={() => setTermsOpen(false)} />
    </Box>
  )
}
