import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import useRemoteSearch from '../../hooks/useRemoteSearch.ts'
import { searchBandProfiles } from '../../api/bandProfiles.ts'
import type { BandProfile } from '../../types/entities.ts'

interface ClaimBandProfileFieldProps {
  selected: BandProfile | null
  onChange: (profile: BandProfile | null) => void
}

/**
 * Optional during onboarding: musicians who aren't on gigbuddy may already be
 * tagging their events with this band, and claiming that profile is how the
 * band takes it over.
 *
 * Entirely optional and never blocking — the claim is submitted after the
 * workspace exists, so nothing here can prevent a band being created.
 */
export default function ClaimBandProfileField({
  selected, onChange,
}: Readonly<ClaimBandProfileFieldProps>) {
  const { t } = useTranslation('onboarding')

  const search = useRemoteSearch<BandProfile>({
    search: async (q) => (await searchBandProfiles({ q })).items.filter((p) => !p.claimed),
  })

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
        {t($ => $.claimProfile.title)}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
        {t($ => $.claimProfile.description)}
      </Typography>

      <TextField
        label={t($ => $.claimProfile.searchLabel)}
        value={search.inputValue}
        onChange={(e) => {
          search.onInputChange(null, e.target.value, 'input')
          onChange(null)
        }}
        helperText={search.tooShort ? t($ => $.claimProfile.searchHint) : undefined}
        fullWidth
      />

      {search.options.length > 0 && (
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1, mt: 1.5 }}>
          {search.options.map((profile) => (
            <Chip
              key={String(profile.id)}
              label={`${profile.name} (${profile.countryCode.toUpperCase()})`}
              clickable
              color={selected?.id === profile.id ? 'primary' : 'default'}
              onClick={() => onChange(selected?.id === profile.id ? null : profile)}
            />
          ))}
        </Stack>
      )}

      {selected && (
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1 }}>
          {t($ => $.claimProfile.pendingReview)}
        </Typography>
      )}
    </Box>
  )
}
