import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import useRemoteSearch from '../../../hooks/useRemoteSearch.ts'
import { searchBandProfiles } from '../../band-profiles/bandProfiles.ts'
import { searchBands, requestToJoinBand } from '../../memberships/bandDirectory.ts'
import type { DirectoryBand } from '../../memberships/bandDirectory.ts'
import { addMyBand } from '../myBands.ts'
import { redeemInvite } from '../../memberships/invites.ts'
import { parseInviteCode } from '../../memberships/inviteCode.ts'
import { isApiError } from '../../../types/api.ts'
import type { BandProfile, Id } from '../../../types/entities.ts'
import CreateBandDialog from '../../../components/appShell/CreateBandDialog.tsx'
import BandProfileFields from './BandProfileFields.tsx'
import { EMPTY_BAND_PROFILE_FORM, hasBandProfileLink } from './bandProfileForm.ts'
import type { BandProfileForm } from './bandProfileForm.ts'

const MIN_QUERY = 3
const DEBOUNCE_MS = 300

type Step = 'search' | 'createProfile' | 'createBand'
type Mode = 'search' | 'invite'

// The two halves of a search, merged into one list so a single hook can own the
// debounce and the request-id race guard.
type SearchHit =
  | { kind: 'band'; band: DirectoryBand }
  | { kind: 'profile'; profile: BandProfile }

interface AddBandDialogProps {
  onClose: () => void
  onAdded: () => void
  onJoined: () => void
  onCreated?: (tenantId: Id) => void
}

/**
 * Adding a band to My Bands. Searching comes first on purpose: a band that
 * already exists — on gigbuddy or as a global profile — must be reused rather
 * than duplicated, so creating is only offered once a search has come back.
 */
export default function AddBandDialog({
  onClose, onAdded, onJoined, onCreated,
}: Readonly<AddBandDialogProps>) {
  const { t } = useTranslation(['myBands', 'common'])
  const [mode, setMode] = useState<Mode>('search')
  const [step, setStep] = useState<Step>('search')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [full, setFull] = useState(false)

  const [form, setForm] = useState<BandProfileForm>(EMPTY_BAND_PROFILE_FORM)
  const [errors, setErrors] = useState<Partial<Record<keyof BandProfileForm, string>>>({})
  const [websiteMatch, setWebsiteMatch] = useState<BandProfile | null>(null)

  const [code, setCode] = useState('')

  // One hook, two sources. They stay separate endpoints on purpose: the
  // directory owns which gigbuddy bands may be seen at all, and a second copy
  // of that rule is how a private band starts leaking.
  const search = useRemoteSearch<SearchHit>({
    enabled: step === 'search' && mode === 'search',
    minChars: MIN_QUERY,
    search: async (q) => {
      const [profileResult, bandResult] = await Promise.allSettled([
        searchBandProfiles({ q }),
        searchBands(q),
      ])
      return [
        ...(bandResult.status === 'fulfilled'
          ? bandResult.value.items.map((band): SearchHit => ({ kind: 'band', band }))
          : []),
        ...(profileResult.status === 'fulfilled'
          ? profileResult.value.items.map((profile): SearchHit => ({ kind: 'profile', profile }))
          : []),
      ]
    },
  })
  const gigbuddyBands = search.options.flatMap((hit) => (hit.kind === 'band' ? [hit.band] : []))
  const profiles = search.options.flatMap((hit) => (hit.kind === 'profile' ? [hit.profile] : []))

  const trimmed = search.query.trim()

  const handleAdd = useCallback(async (bandProfileId: BandProfile['id']) => {
    setBusy(true)
    setError(null)
    try {
      await addMyBand({ bandProfileId })
      onAdded()
    } catch (e) {
      if (isApiError(e) && e.code === 'band_profile_full') setFull(true)
      else setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [onAdded])

  async function handleJoinGigbuddyBand(tenantId: DirectoryBand['id']) {
    setBusy(true)
    setError(null)
    try {
      await requestToJoinBand(tenantId)
      onJoined()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleRedeem() {
    const parsed = parseInviteCode(code)
    if (!parsed) {
      setError(t($ => $.add.errors.noCode))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await redeemInvite(parsed)
      onJoined()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // Checked when the artist leaves the website field, which is the first moment
  // the answer exists — the name search is long over by then.
  async function handleWebsiteBlur() {
    const website = form.websiteUrl.trim()
    if (!website) { setWebsiteMatch(null); return }
    try {
      const { items } = await searchBandProfiles({ website })
      setWebsiteMatch(items.find((item) => item.websiteMatch) ?? null)
    } catch {
      setWebsiteMatch(null)
    }
  }

  function handleFieldChange(field: keyof BandProfileForm, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  async function handleCreate() {
    const nextErrors: Partial<Record<keyof BandProfileForm, string>> = {}
    if (!form.name.trim()) nextErrors.name = t($ => $.errors.nameRequired)
    if (!form.countryCode) nextErrors.countryCode = t($ => $.errors.countryRequired)
    if (!hasBandProfileLink(form)) {
      nextErrors.spotifyUrl = t($ => $.errors.needsLink)
      nextErrors.websiteUrl = t($ => $.errors.needsLink)
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setBusy(true)
    setError(null)
    try {
      // One call: the server creates the profile and holds it in one
      // transaction, so a failure here leaves nothing behind.
      await addMyBand({
        bandProfile: {
          name: form.name.trim(),
          countryCode: form.countryCode,
          spotifyUrl: form.spotifyUrl.trim() || null,
          websiteUrl: form.websiteUrl.trim() || null,
          contactEmail: form.contactEmail.trim() || null,
        },
      })
      onAdded()
    } catch (e) {
      if (isApiError(e) && e.code === 'band_profile_full') setFull(true)
      else setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (full) {
    return (
      <Dialog open fullWidth maxWidth="sm" onClose={onClose}>
        <DialogTitle>{t($ => $.add.full.title)}</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>{t($ => $.add.full.body)}</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t($ => $.add.full.invite)}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t($ => $.common.actions.close)}</Button>
        </DialogActions>
      </Dialog>
    )
  }

  if (step === 'createBand') {
    return (
      <CreateBandDialog
        open
        defaultBandName={trimmed}
        onClose={() => setStep('search')}
        onCreated={(tenantId) => {
          if (onCreated) onCreated(tenantId)
          else onJoined()
        }}
      />
    )
  }

  return (
    <Dialog open fullWidth maxWidth="md" onClose={onClose}>
      <DialogTitle>{t($ => $.add.title)}</DialogTitle>
      <DialogContent>
        {step === 'search' && (
          <Tabs value={mode} onChange={(_e, next) => { setMode(next); setError(null) }} sx={{ mb: 2 }}>
            <Tab value="search" label={t($ => $.add.tabs.search)} />
            <Tab value="invite" label={t($ => $.add.tabs.invite)} />
          </Tabs>
        )}

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {step === 'search' && mode === 'invite' && (
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {t($ => $.add.inviteHelp)}
            </Typography>
            <TextField
              label={t($ => $.add.inviteCode)}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              fullWidth
            />
            <Box>
              <Button variant="contained" disabled={busy || !code.trim()} onClick={handleRedeem}>
                {t($ => $.add.join)}
              </Button>
            </Box>
          </Stack>
        )}

        {step === 'search' && mode === 'search' && (
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {t($ => $.add.workflow.intro)}
            </Typography>

            <TextField
              label={t($ => $.add.searchLabel)}
              value={search.inputValue}
              onChange={(e) => search.onInputChange(null, e.target.value, 'input')}
              helperText={search.tooShort ? t($ => $.add.searchHint) : undefined}
              autoFocus
              fullWidth
            />

            {search.loading && (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}><CircularProgress size={24} /></Box>
            )}

            {!search.loading && !search.tooShort && gigbuddyBands.length > 0 && (
              <Box>
                <Typography variant="overline" sx={{ color: 'text.secondary' }}>
                  {t($ => $.add.groups.onGigbuddy)}
                </Typography>
                <List dense disablePadding>
                  {gigbuddyBands.map((band) => (
                    <ListItemButton
                      key={String(band.id)}
                      disabled={busy || band.membershipStatus !== 'none'}
                      onClick={() => handleJoinGigbuddyBand(band.id)}
                    >
                      <ListItemText
                        primary={band.displayName}
                        secondary={band.membershipStatus === 'none'
                          ? t($ => $.add.askToJoin)
                          : t($ => $.add.alreadyRequested)}
                      />
                    </ListItemButton>
                  ))}
                </List>
              </Box>
            )}

            {!search.loading && !search.tooShort && profiles.length > 0 && (
              <Box>
                <Typography variant="overline" sx={{ color: 'text.secondary' }}>
                  {t($ => $.add.groups.offGigbuddy)}
                </Typography>
                <List dense disablePadding>
                  {profiles.map((profile) => (
                    <ListItemButton
                      key={String(profile.id)}
                      disabled={busy || profile.claimed}
                      onClick={() => handleAdd(profile.id)}
                    >
                      <ListItemText
                        primary={profile.name}
                        secondary={profile.countryCode.toUpperCase()}
                      />
                      {profile.claimed && (
                        <Chip size="small" label={t($ => $.add.nowOnGigbuddy)} />
                      )}
                    </ListItemButton>
                  ))}
                </List>
              </Box>
            )}

            {!search.loading && !search.tooShort && gigbuddyBands.length === 0 && profiles.length === 0 && (
              <Alert severity="info">{t($ => $.add.noResults)}</Alert>
            )}

            <Divider />
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                gap: 2,
              }}
            >
              <Paper variant="outlined" sx={{ p: 2, display: 'flex', flexDirection: 'column' }}>
                <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
                  {t($ => $.add.workflow.createBand.title)}
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary', flexGrow: 1, mb: 2 }}>
                  {t($ => $.add.workflow.createBand.body)}
                </Typography>
                <Button
                  variant="outlined"
                  disabled={search.tooShort || search.loading}
                  onClick={() => setStep('createBand')}
                >
                  {t($ => $.add.workflow.createBand.action)}
                </Button>
              </Paper>

              <Paper variant="outlined" sx={{ p: 2, display: 'flex', flexDirection: 'column' }}>
                <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
                  {t($ => $.add.workflow.createProfile.title)}
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary', flexGrow: 1, mb: 2 }}>
                  {t($ => $.add.workflow.createProfile.body)}
                </Typography>
                <Button
                  variant="outlined"
                  disabled={search.tooShort || search.loading}
                  onClick={() => {
                    setForm({ ...EMPTY_BAND_PROFILE_FORM, name: trimmed })
                    setStep('createProfile')
                  }}
                >
                  {t($ => $.add.workflow.createProfile.action)}
                </Button>
              </Paper>
            </Box>
          </Stack>
        )}

        {step === 'createProfile' && (
          <Box sx={{ pt: 1 }}>
            {websiteMatch && (
              <Alert
                severity="info"
                sx={{ mb: 2 }}
                action={(
                  <Button size="small" disabled={busy} onClick={() => handleAdd(websiteMatch.id)}>
                    {t($ => $.add.useExisting)}
                  </Button>
                )}
              >
                {t($ => $.add.websiteMatch, { name: websiteMatch.name })}
              </Alert>
            )}
            <BandProfileFields
              form={form}
              onChange={handleFieldChange}
              errors={errors}
              onWebsiteBlur={() => { void handleWebsiteBlur() }}
            />
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        {step === 'createProfile' && (
          <Button onClick={() => { setStep('search'); setWebsiteMatch(null) }}>
            {t($ => $.common.actions.back)}
          </Button>
        )}
        <Box sx={{ flexGrow: 1 }} />
        <Button onClick={onClose}>{t($ => $.common.actions.cancel)}</Button>
        {step === 'createProfile' && (
          <Button variant="contained" disabled={busy} onClick={handleCreate}>
            {t($ => $.add.create)}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
