import Box from '@mui/material/Box'
import AlbumIcon from '@mui/icons-material/Album'
import { useEntitlements } from '../hooks/useEntitlements.ts'

interface SongCoverThumbProps {
  /** object key of the cover image; null/undefined renders the placeholder */
  path?: string | null
  /** rendered square size in px */
  size?: number
  alt?: string
}

/**
 * Square song cover image, or a thin outlined square with an album icon when
 * no cover is set. Covers are customization data: when the plan lacks that
 * feature the placeholder shows even if a cover is stored (presentation only —
 * the upload API gate is the defense). The server stores covers square, but
 * small originals keep their dimensions, so `objectFit: cover` square-crops
 * here regardless.
 */
export default function SongCoverThumb({ path, size = 40, alt = '' }: Readonly<SongCoverThumbProps>) {
  const { has } = useEntitlements()
  if (path && has('customization')) {
    return (
      <Box
        component="img"
        src={`/api/files/${path}`}
        alt={alt}
        sx={{ width: size, height: size, objectFit: 'cover', display: 'block', flexShrink: 0 }}
      />
    )
  }
  return (
    <Box
      sx={{
        width: size,
        height: size,
        border: '1px solid',
        borderColor: 'divider',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'text.disabled',
        flexShrink: 0,
      }}
    >
      <AlbumIcon sx={{ fontSize: Math.round(size * 0.6) }} />
    </Box>
  )
}
