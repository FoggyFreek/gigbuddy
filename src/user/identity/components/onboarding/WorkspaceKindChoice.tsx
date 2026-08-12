import { useTranslation } from 'react-i18next'
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
                sx={{ p: 2, height: '100%' }}
              >
                <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
                  <Icon color={selected ? 'primary' : 'action'} />
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    {t($ => $.kindChoice[kind].label)}
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
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
