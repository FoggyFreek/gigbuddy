import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import FormControlLabel from '@mui/material/FormControlLabel'
import Grid from '@mui/material/Grid'
import InputAdornment from '@mui/material/InputAdornment'
import Paper from '@mui/material/Paper'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import Stack from '@mui/material/Stack'
import Step from '@mui/material/Step'
import StepContent from '@mui/material/StepContent'
import StepLabel from '@mui/material/StepLabel'
import Stepper from '@mui/material/Stepper'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined'
import DateEntryField from '../components/DateEntryField.tsx'
import { FinancialsEditForm } from '../components/profile/ProfileFinancialsTab.tsx'
import DefaultAccountsFields from '../components/settings/DefaultAccountsFields.tsx'
import { MollieKeySection, ShopifyKeySection } from '../components/settings/IntegrationsSection.tsx'
import { EMPTY_FORM, profileToForm, type ProfileForm } from '../components/profile/profileForm.ts'
import { getProfile, updateProfile } from '../api/profile.ts'
import { getFinanceOnboardingStatus, setOpeningBalance } from '../api/financeOnboarding.ts'
import { useCompactLayout } from '../hooks/useCompactLayout.ts'

const STEP_KEYS = ['welcome', 'openingBalance', 'profile', 'integrations', 'accounts', 'done'] as const
type StepKey = typeof STEP_KEYS[number]

// Financial subset of the profile form persisted by the wizard's profile step.
function financialFields(form: ProfileForm) {
  return {
    formal_name: form.formal_name,
    address_street: form.address_street,
    address_postal_code: form.address_postal_code,
    address_city: form.address_city,
    address_country: form.address_country,
    kvk_number: form.kvk_number,
    iban: form.iban,
    tax_id: form.tax_id,
    tax_percentage: form.tax_percentage,
    applies_kor: form.applies_kor,
  }
}

// A euro string ("1234.56", "1.234,56", "-50") → signed integer cents, or null
// when malformed.
function euroToCents(input: string): number | null {
  const normalized = input.trim().replace(/\s/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')
  if (!/^-?\d+(\.\d{1,2})?$/.test(normalized)) return null
  return Math.round(parseFloat(normalized) * 100)
}

const KNOWN_ERROR_CODES = new Set(['opening_balance_exists', 'invalid_amount', 'period_closed'])

export default function FinanceOnboardingPage() {
  const { t } = useTranslation('financeOnboarding')
  const navigate = useNavigate()
  const isCompact = useCompactLayout()
  const [activeStep, setActiveStep] = useState(0)

  // Opening-balance step state.
  const [openingBalanceSet, setOpeningBalanceSetState] = useState(false)
  const [balanceChoice, setBalanceChoice] = useState<'manual' | 'later'>('manual')
  const [amount, setAmount] = useState('')
  const [balanceDate, setBalanceDate] = useState(() => new Date().toISOString().slice(0, 10))

  // Profile step state.
  const [form, setForm] = useState<ProfileForm>(EMPTY_FORM)

  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    getFinanceOnboardingStatus()
      .then((s) => { if (active) setOpeningBalanceSetState(s.openingBalanceSet) })
      .catch(() => {})
    getProfile()
      .then((p) => { if (active) setForm(profileToForm(p as unknown as Record<string, unknown>)) })
      .catch(() => {})
    return () => { active = false }
  }, [])

  const step: StepKey = STEP_KEYS[activeStep]
  const isLast = activeStep === STEP_KEYS.length - 1

  function errorMessageFor(err: unknown): string {
    const body = (err as { body?: { code?: string } })?.body
    const code = body?.code
    if (typeof code === 'string' && KNOWN_ERROR_CODES.has(code)) {
      return t($ => $.errors[code as 'opening_balance_exists' | 'invalid_amount' | 'period_closed'])
    }
    return t($ => $.errors.generic)
  }

  // Runs the side effect a step owns before advancing. Returns false to stay put.
  async function commitStep(current: StepKey): Promise<boolean> {
    setError(null)
    if (current === 'openingBalance' && !openingBalanceSet && balanceChoice === 'manual') {
      const cents = euroToCents(amount)
      if (cents === null || cents === 0) { setError(t($ => $.errors.invalid_amount)); return false }
      setBusy(true)
      try {
        await setOpeningBalance({ amountCents: cents, entryDate: balanceDate })
        setOpeningBalanceSetState(true)
      } catch (err) {
        setError(errorMessageFor(err))
        return false
      } finally {
        setBusy(false)
      }
    }
    if (current === 'profile') {
      setBusy(true)
      try {
        await updateProfile(financialFields(form))
      } catch {
        setError(t($ => $.errors.generic))
        return false
      } finally {
        setBusy(false)
      }
    }
    return true
  }

  async function handleNext() {
    if (await commitStep(step)) setActiveStep((s) => Math.min(s + 1, STEP_KEYS.length - 1))
  }

  function handleBack() {
    setError(null)
    setActiveStep((s) => Math.max(s - 1, 0))
  }

  // The opening-balance step may be skipped ("set it later"); other steps use Next.
  const canSkip = step === 'openingBalance' && !openingBalanceSet && balanceChoice === 'later'

  // Body for the currently active step — rendered inside the outlined Paper
  // (horizontal) or inside the active StepContent (vertical/compact).
  const stepBody = (
    <>
      {step === 'welcome' && <WelcomeStep />}
      {step === 'openingBalance' && (
        <OpeningBalanceStep
          alreadySet={openingBalanceSet}
          choice={balanceChoice}
          setChoice={setBalanceChoice}
          amount={amount}
          setAmount={setAmount}
          date={balanceDate}
          setDate={setBalanceDate}
        />
      )}
      {step === 'profile' && (
        <>
          <Typography variant="h6" sx={{ mb: 0.5 }}>{t($ => $.profile.heading)}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{t($ => $.profile.body)}</Typography>
          <FinancialsEditForm
            form={form}
            onChange={(field, value) => setForm((prev) => ({ ...prev, [field]: value }))}
            onFormChange={setForm}
            schedule={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
          />
        </>
      )}
      {step === 'integrations' && (
        <>
          <Typography variant="h6" sx={{ mb: 0.5 }}>{t($ => $.integrations.heading)}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{t($ => $.integrations.body)}</Typography>
          <MollieKeySection />
          <ShopifyKeySection />
        </>
      )}
      {step === 'accounts' && (
        <>
          <Typography variant="h6" sx={{ mb: 0.5 }}>{t($ => $.accounts.heading)}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{t($ => $.accounts.body)}</Typography>
          <DefaultAccountsFields />
        </>
      )}
      {step === 'done' && <DoneStep onGoToDashboard={() => navigate('/financial')} />}
    </>
  )

  const controls = (
    <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between' }}>
      <Button onClick={handleBack} disabled={activeStep === 0 || busy}>{t($ => $.actions.back)}</Button>
      {!isLast && (
        <Button variant="contained" onClick={handleNext} disabled={busy}>
          {canSkip ? t($ => $.actions.skip) : t($ => $.actions.next)}
        </Button>
      )}
      {isLast && (
        <Button variant="contained" onClick={() => navigate('/financial')}>{t($ => $.actions.finish)}</Button>
      )}
    </Stack>
  )

  const errorAlert = error && (
    <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>
  )

  return (
    <Box sx={{ maxWidth: 820, mx: 'auto' }}>
      <Typography variant="h5" sx={{ mb: 2 }}>{t($ => $.title)}</Typography>

      {isCompact ? (
        // Compact: nest each step's body + controls inside its StepContent so
        // only the active step expands, instead of stacking six labels tall.
        <Stepper activeStep={activeStep} orientation="vertical">
          {STEP_KEYS.map((key) => (
            <Step key={key}>
              <StepLabel>{t($ => $.steps[key])}</StepLabel>
              <StepContent>
                {key === step && (
                  <>
                    {errorAlert}
                    <Box sx={{ mb: 2 }}>{stepBody}</Box>
                    {controls}
                  </>
                )}
              </StepContent>
            </Step>
          ))}
        </Stepper>
      ) : (
        <>
          <Stepper activeStep={activeStep} alternativeLabel sx={{ mb: 3 }}>
            {STEP_KEYS.map((key) => (
              <Step key={key}><StepLabel>{t($ => $.steps[key])}</StepLabel></Step>
            ))}
          </Stepper>

          {errorAlert}

          <Paper variant="outlined" sx={{ p: 3, mb: 2 }}>{stepBody}</Paper>

          {controls}
        </>
      )}
    </Box>
  )
}

function WelcomeStep() {
  const { t } = useTranslation('financeOnboarding')
  return (
    <>
      <Typography variant="h6" sx={{ mb: 0.5 }}>{t($ => $.welcome.heading)}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{t($ => $.welcome.body)}</Typography>
      <Stack spacing={1}>
        <Typography variant="body2">• {t($ => $.welcome.featureInvoicing)}</Typography>
        <Typography variant="body2">• {t($ => $.welcome.featurePurchases)}</Typography>
        <Typography variant="body2">• {t($ => $.welcome.featureReports)}</Typography>
      </Stack>
    </>
  )
}

interface OpeningBalanceStepProps {
  alreadySet: boolean
  choice: 'manual' | 'later'
  setChoice: (c: 'manual' | 'later') => void
  amount: string
  setAmount: (v: string) => void
  date: string
  setDate: (v: string) => void
}

function OpeningBalanceStep({ alreadySet, choice, setChoice, amount, setAmount, date, setDate }: Readonly<OpeningBalanceStepProps>) {
  const { t } = useTranslation('financeOnboarding')
  return (
    <>
      <Typography variant="h6" sx={{ mb: 0.5 }}>{t($ => $.openingBalance.heading)}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{t($ => $.openingBalance.body)}</Typography>

      {alreadySet ? (
        <Alert severity="success">{t($ => $.openingBalance.alreadySet)}</Alert>
      ) : (
        <>
          <RadioGroup value={choice} onChange={(e) => setChoice(e.target.value as 'manual' | 'later')}>
            <FormControlLabel value="manual" control={<Radio />} label={t($ => $.openingBalance.choiceManual)} />
            <FormControlLabel value="later" control={<Radio />} label={t($ => $.openingBalance.choiceLater)} />
          </RadioGroup>

          {choice === 'manual' ? (
            <Grid container spacing={2} sx={{ mt: 0.5 }}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  fullWidth
                  label={t($ => $.openingBalance.amount)}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  slotProps={{ input: { startAdornment: <InputAdornment position="start">€</InputAdornment> } }}
                  helperText={t($ => $.openingBalance.negativeHint)}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <DateEntryField
                  id="opening-balance-date"
                  label={t($ => $.openingBalance.date)}
                  fullWidth
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  sx={undefined}
                />
              </Grid>
            </Grid>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{t($ => $.openingBalance.laterHelp)}</Typography>
          )}
        </>
      )}
    </>
  )
}

function DoneStep({ onGoToDashboard }: Readonly<{ onGoToDashboard: () => void }>) {
  const { t } = useTranslation('financeOnboarding')
  return (
    <Box sx={{ textAlign: 'center', py: 2 }}>
      <CheckCircleOutlineIcon color="success" sx={{ fontSize: 48, mb: 1 }} />
      <Typography variant="h6" sx={{ mb: 0.5 }}>{t($ => $.done.heading)}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{t($ => $.done.body)}</Typography>
      <Button variant="outlined" onClick={onGoToDashboard}>{t($ => $.done.toDashboard)}</Button>
    </Box>
  )
}
