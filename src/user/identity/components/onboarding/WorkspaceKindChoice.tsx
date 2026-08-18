import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import FormLabel from '@mui/material/FormLabel'
import GroupsOutlined from '@mui/icons-material/GroupsOutlined'
import PersonOutlined from '@mui/icons-material/PersonOutlined'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import type { SvgIconComponent } from '@mui/icons-material'
import { TENANT_KINDS, type TenantKind } from '../../../../auth/tenantKinds.ts'

const KIND_ICONS: Record<TenantKind, SvgIconComponent> = {
  band: GroupsOutlined,
  personal: PersonOutlined,
}

// Decorative only (alt=""): the tile's accessible name must stay its copy.
const KIND_IMAGES: Record<TenantKind, string> = {
  band: '/images/band-rehearsal.webp',
  personal: '/images/artist.webp',
}

/** What the free trial means for one kind. Absent = show no trial badge. */
export interface KindTrialOffer {
  /** Tier art for that ladder's trial plan, resolved by the caller. */
  logoSrc: string | null
  state: 'start' | 'onTrial' | 'add'
  trialDays: number
  daysRemaining: number | null
}

interface WorkspaceKindChoiceProps {
  value: TenantKind
  onChange: (kind: TenantKind) => void
  disabled?: boolean
  trialOffer?: Partial<Record<TenantKind, KindTrialOffer>>
}

// "What are you setting up?" — a band, or the musician's own artist workspace.
// Both paths create an owned tenant; the choice only picks which service call
// the wizard makes and which copy the remaining steps use.
export default function WorkspaceKindChoice({
  value, onChange, disabled = false, trialOffer,
}: Readonly<WorkspaceKindChoiceProps>) {
  const { t } = useTranslation('onboarding')

  const badgeLabel = (offer: KindTrialOffer) => {
    if (offer.state === 'onTrial') return t($ => $.welcome.trialOffer.onTrial)
    if (offer.state === 'add') {
      return t($ => $.welcome.trialOffer.addToTrial, { count: offer.daysRemaining ?? 0 })
    }
    return t($ => $.welcome.trialOffer.badge, { days: offer.trialDays })
  }

  return (
    <Stack spacing={1.5}>
      <FormLabel component="legend">{t($ => $.kindChoice.title)}</FormLabel>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        role="radiogroup"
        aria-label={t($ => $.kindChoice.title)}
      >
        {TENANT_KINDS.map((kind) => {
          const Icon = KIND_ICONS[kind]
          const selected = value === kind
          const offer = trialOffer?.[kind]
          return (
            <Card
              key={kind}
              variant="outlined"
              sx={{
                flex: 1,
                borderColor: selected ? 'primary.main' : undefined,
                borderWidth: selected ? 2 : 1,
              }}
            >
              <CardActionArea
                role="radio"
                aria-checked={selected}
                disabled={disabled}
                onClick={() => onChange(kind)}
                sx={{ p: 0, aspectRatio: '1 / 1', position: 'relative' }}
              >
                <Box
                  component="img"
                  src={KIND_IMAGES[kind]}
                  alt=""
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: 'block',
                  }}
                />
                {/* The offer itself: tier art and the trial bar, on their own
                    top scrim so they stay legible over any photo. */}
                {offer && (
                  <Stack
                    spacing={1}
                    sx={{
                      position: 'absolute',
                      insetInline: 0,
                      top: 0,
                      p: 1.5,
                      alignItems: 'center',
                      background: 'linear-gradient(to bottom, rgba(0, 0, 0, 0.55), rgba(0, 0, 0, 0))',
                    }}
                  >
                    {offer.logoSrc && (
                      <Box
                        component="img"
                        src={offer.logoSrc}
                        alt=""
                        sx={{ width: 40, height: 40, display: 'block' }}
                      />
                    )}
                    <Box
                      sx={{
                        bgcolor: 'primary.main',
                        color: 'primary.contrastText',
                        px: 1,
                        py: 0.25,
                        borderRadius: 0.5,
                        maxWidth: '100%',
                      }}
                    >
                      <Typography
                        variant="caption"
                        sx={{
                          display: 'block',
                          textAlign: 'center',
                          fontWeight: 700,
                          lineHeight: 1.4,
                          textTransform: 'uppercase',
                          letterSpacing: '0.08em',
                          color: 'inherit',
                        }}
                      >
                        {badgeLabel(offer)}
                      </Typography>
                    </Box>
                  </Stack>
                )}
                {/* Scrim panel: the copy sits on translucent black so it stays
                    legible whatever the photo does underneath. */}
                <Stack
                  spacing={0.5}
                  sx={{
                    position: 'absolute',
                    insetInline: 0,
                    bottom: 0,
                    p: 2,
                    bgcolor: 'rgba(0, 0, 0, 0.55)',
                    color: 'common.white',
                  }}
                >
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <Icon fontSize="small" sx={{ color: 'inherit' }} />
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'inherit' }}>
                      {t($ => $.kindChoice[kind].label)}
                    </Typography>
                  </Stack>
                  <Typography variant="body2" sx={{ color: 'inherit', opacity: 0.85 }}>
                    {t($ => $.kindChoice[kind].help)}
                  </Typography>
                </Stack>
              </CardActionArea>
            </Card>
          )
        })}
      </Stack>
    </Stack>
  )
}
