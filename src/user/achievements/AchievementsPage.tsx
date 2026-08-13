import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Grid from '@mui/material/Grid'
import Typography from '@mui/material/Typography'
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents'
import AchievementBanner from './components/AchievementBanner.tsx'
import { listAchievements } from './achievements.ts'
import { useThemeMode } from '../../contexts/themeModeContext.ts'
import type { Achievement, AchievementCategory } from '../../types/entities.ts'

const CATEGORY_ORDER: AchievementCategory[] = [
  'profile',
  'gigs',
  'invoices',
  'purchase',
  'merchandise',
  'finance',
  'platform',
  'repertoire',
  'network',
  'artist'
]

interface CategorySection {
  category: AchievementCategory
  achievements: Achievement[]
}

// Group into the fixed category order; within a category unlocked come first,
// preserving server order otherwise.
function buildSections(achievements: Achievement[]): CategorySection[] {
  return CATEGORY_ORDER.map((category) => {
    const items = achievements.filter((a) => a.category === category)
    return {
      category,
      achievements: [
        ...items.filter((a) => a.unlocked_at !== null),
        ...items.filter((a) => a.unlocked_at === null),
      ],
    }
  }).filter((s) => s.achievements.length > 0)
}

export default function AchievementsPage() {
  const { t } = useTranslation('achievements')
  const { mode } = useThemeMode()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [achievements, setAchievements] = useState<Achievement[]>([])

  useEffect(() => {
    let cancelled = false
    listAchievements()
      .then((data) => {
        if (!cancelled) {
          setAchievements(data)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true)
          setLoading(false)
        }
      })
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    )
  }

  if (error) {
    return (
      <Typography variant="body2" sx={{ color: 'error.main', py: 2 }}>
        {t($ => $.loadError)}
      </Typography>
    )
  }

  const earned = achievements
    .filter((a) => a.unlocked_at !== null)
    .reduce((sum, a) => sum + a.cheers, 0)
  const total = achievements.reduce((sum, a) => sum + a.cheers, 0)

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <EmojiEventsIcon />
        <Typography variant="h5" sx={{ fontWeight: 600 }}>
          {t($ => $.title)}
        </Typography>
        <Chip
          size="small"
          aria-label={t($ => $.summaryAria, { earned, total })}
          label={
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1 }}>
              <Box
                component="img"
                src={mode === 'dark' ? '/icons/clap_light.png' : '/icons/clap_dark.png'}
                alt=""
                aria-hidden="true"
                sx={{ width: 28, height: 'auto', display: 'block' }}
              />
              <Box component="span" sx={{ fontWeight: 600, mt: 0.25 }}>
                {t($ => $.summary, { earned, total })}
              </Box>
            </Box>
          }
          sx={{ height: 'auto', ml: 'auto', bgcolor: 'transparent', '& .MuiChip-label': { px: 0.5, py: 0.5 } }}
        />
      </Box>

      {buildSections(achievements).map(({ category, achievements: items }) => (
        <Box key={category} sx={{ mb: 4 }}>
          <Typography variant="h6" sx={{ mb: 1.5 }}>
            {t($ => $.categories[category])}
          </Typography>
          <Grid container spacing={2} sx={{ alignItems: 'stretch' }}>
            {items.map((achievement) => (
              <Grid key={achievement.key} size={{ xs: 12, sm: 6, lg: 4 }}>
                <AchievementBanner achievement={achievement} />
              </Grid>
            ))}
          </Grid>
        </Box>
      ))}
    </Box>
  )
}
