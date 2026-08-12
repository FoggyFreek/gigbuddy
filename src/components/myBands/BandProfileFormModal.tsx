import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import useDebouncedSave from '../../hooks/useDebouncedSave.ts'
import SaveStatusLabel from '../SaveStatusLabel.tsx'
import { getBandProfile, updateBandProfile } from '../../api/bandProfiles.ts'
import type { BandProfile, Id } from '../../types/entities.ts'
import BandProfileFields from './BandProfileFields.tsx'
import { EMPTY_BAND_PROFILE_FORM, hasBandProfileLink, profileToForm } from './bandProfileForm.ts'
import type { BandProfileForm } from './bandProfileForm.ts'

interface BandProfileFormModalProps {
  profileId: Id
  onClose: () => void
}

/**
 * Editing a band profile the caller created. Autosaves like the other edit
 * modals; the server is the authority on whether the caller may still write —
 * a claim freezes the profile, so an edit that was allowed when the modal
 * opened can legitimately stop being allowed.
 */
export default function BandProfileFormModal({ profileId, onClose }: Readonly<BandProfileFormModalProps>) {
  const { t } = useTranslation(['myBands', 'common'])
  const [profile, setProfile] = useState<BandProfile | null>(null)
  const [form, setForm] = useState<BandProfileForm>(EMPTY_BAND_PROFILE_FORM)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getBandProfile(profileId)
      .then((loaded) => {
        if (cancelled) return
        setProfile(loaded)
        setForm(profileToForm(loaded))
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
    return () => { cancelled = true }
  }, [profileId])

  const saveFn = useCallback(
    async (patch: Partial<BandProfileForm>) => {
      setError(null)
      try {
        setProfile(await updateBandProfile(profileId, patch))
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        throw e
      }
    },
    [profileId],
  )
  const { schedule, flush, status: saveStatus } = useDebouncedSave(saveFn)

  const readOnly = profile !== null && profile.canEdit === false
  // Clearing the last link is refused server-side, so don't schedule a save
  // that is certain to fail — say so while they are still typing.
  const missingLink = !hasBandProfileLink(form)

  function handleChange(field: keyof BandProfileForm, value: string) {
    const next = { ...form, [field]: value }
    setForm(next)
    if (readOnly) return
    if (!hasBandProfileLink(next)) return
    schedule({ [field]: value === '' ? null : value } as Partial<BandProfileForm>)
  }

  async function handleClose() {
    try {
      await flush()
    } catch {
      // The error is already on screen; closing must not be blocked by it.
    }
    onClose()
  }

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={handleClose}>
      <DialogTitle>{t($ => $.editProfile.title)}</DialogTitle>
      <DialogContent>
        {profile === null && error === null && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
        )}
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {readOnly && (
          <Alert severity="info" sx={{ mb: 2 }}>{t($ => $.editProfile.locked)}</Alert>
        )}
        {profile !== null && (
          <Box sx={{ pt: 1 }}>
            <BandProfileFields
              form={form}
              onChange={handleChange}
              disabled={readOnly}
              errors={missingLink
                ? { spotifyUrl: t($ => $.errors.needsLink), websiteUrl: t($ => $.errors.needsLink) }
                : {}}
            />
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between' }}>
        <SaveStatusLabel status={saveStatus} />
        <Button variant="contained" onClick={handleClose}>{t($ => $.common.actions.close)}</Button>
      </DialogActions>
    </Dialog>
  )
}
