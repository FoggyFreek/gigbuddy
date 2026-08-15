import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import type { BackgroundMeta } from '../../utils/backgroundMeta.ts'

interface Props {
  meta: BackgroundMeta
}

// Small corner caption for a full-bleed background image: a short description
// plus its credit/attribution. Renders nothing once both fields are blank, so
// backgrounds without metadata filled in yet look exactly as before. The
// parent must establish a positioning context (relative/absolute/fixed).
export default function BackgroundAttribution({ meta }: Readonly<Props>) {
  const { description, credit, creditUrl } = meta
  if (!description && !credit) return null

  return (
    <Box
      sx={{
        position: 'absolute',
        right: 12,
        bottom: 12,
        zIndex: 1,
        maxWidth: 320,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.25,
        px: 1.25,
        py: 0.75,
        borderRadius: 1,
        bgcolor: 'rgba(0, 0, 0, 0.45)',
        pointerEvents: 'none',
      }}
    >
      {description && (
        <Typography variant="caption" sx={{ color: '#fff', lineHeight: 1.3 }}>
          {description}
        </Typography>
      )}
      {credit && (
        <Typography variant="caption" sx={{ color: '#fff', opacity: 0.75, fontSize: '0.65rem' }}>
          {creditUrl ? (
            <Box
              component="a"
              href={creditUrl}
              target="_blank"
              rel="noopener noreferrer"
              sx={{ color: 'inherit', pointerEvents: 'auto' }}
            >
              {credit}
            </Box>
          ) : credit}
        </Typography>
      )}
    </Box>
  )
}
