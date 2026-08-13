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

interface WorkspaceKindChoiceProps {
  value: TenantKind
  onChange: (kind: TenantKind) => void
  disabled?: boolean
}

// "What are you setting up?" — a band, or the musician's own artist workspace.
// Both paths create an owned tenant; the choice only picks which service call
// the wizard makes and which copy the remaining steps use.
export default function WorkspaceKindChoice({
  value, onChange, disabled = false,
}: Readonly<WorkspaceKindChoiceProps>) {
  const { t } = useTranslation('onboarding')

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
