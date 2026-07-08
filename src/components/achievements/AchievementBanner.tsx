import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import Typography from '@mui/material/Typography'
import type { Achievement } from '../../types/entities.ts'
import { ACHIEVEMENT_KEY_ICONS, ACHIEVEMENT_CATEGORY_ICONS } from './achievementIcons.ts'
import CheersBadge from './CheersBadge.tsx'

interface AchievementBannerProps {
  achievement: Achievement
}

/**
 * One achievement row: goal icon, title with a description clamped to two
 * lines, and the cheers badge. Locked achievements render dimmed.
 */
export default function AchievementBanner({ achievement }: Readonly<AchievementBannerProps>) {
  const { t, i18n } = useTranslation('achievements')
  const { key, category, cheers, unlocked_at: unlockedAt } = achievement
  // Static component selection (NavItem-style member lookup, not a call) so the
  // react-hooks/static-components rule can see no component is created here.
  const Icon = ACHIEVEMENT_KEY_ICONS[key] ?? ACHIEVEMENT_CATEGORY_ICONS[category]
  const locked = unlockedAt === null

  return (
    <Card
      variant="outlined"
      data-testid={`achievement-${key}`}
      data-locked={locked ? 'true' : 'false'}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        p: 2,
        height: '100%',
        opacity: locked ? 0.55 : 1,
      }}
    >
      <Icon fontSize="large" sx={{ color: locked ? 'text.disabled' : 'primary.main' }} />
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          {t($ => $.items[key].title)}
        </Typography>
        <Typography
          variant="body2"
          sx={{
            color: 'text.secondary',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {t($ => $.items[key].description)}
        </Typography>
        {unlockedAt !== null && (
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {t($ => $.unlockedOn, {
              date: new Date(unlockedAt).toLocaleDateString(i18n.language),
            })}
          </Typography>
        )}
      </Box>
      <CheersBadge cheers={cheers} />
    </Card>
  )
}
