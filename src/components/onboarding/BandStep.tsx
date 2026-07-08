import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { slugFromBandName } from '../../utils/slugify.ts'
import { useImageCrop, JPEG_PNG_WEBP } from '../../hooks/useImageCrop.ts'
import { compressLogo } from '../../utils/compressImage.ts'
import ImageCropDialog from '../ImageCropDialog.tsx'

interface BandStepProps {
  bandName: string
  onBandNameChange: (name: string) => void
  /** Band already created in an earlier attempt — name and slug are fixed. */
  resumedSlug: string | null
  logoFile: File | null
  /** Object URL for the selected logo, owned (created/revoked) by the parent. */
  logoPreviewUrl: string | null
  onLogoFileChange: (file: File | null) => void
}

export default function BandStep({
  bandName,
  onBandNameChange,
  resumedSlug,
  logoFile,
  logoPreviewUrl,
  onLogoFileChange,
}: Readonly<BandStepProps>) {
  const { t } = useTranslation(['onboarding', 'profile'])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const slug = resumedSlug ?? slugFromBandName(bandName)
  const [logoError, setLogoError] = useState<string | null>(null)

  // Same crop → compress pipeline as the profile logo uploader, except the
  // "upload" step just hands the cropped file back to the parent — nothing is
  // sent to the server until the band actually exists (onboarding confirm).
  const crop = useImageCrop(
    compressLogo,
    async (file) => onLogoFileChange(file),
    setLogoError,
    JPEG_PNG_WEBP,
  )

  return (
    <Stack spacing={3}>
      <Typography variant="h6">{t($ => $.band.title)}</Typography>

      <TextField
        label={t($ => $.band.nameLabel)}
        value={bandName}
        onChange={(e) => onBandNameChange(e.target.value)}
        disabled={resumedSlug !== null}
        fullWidth
        autoFocus
        slotProps={{ htmlInput: { maxLength: 120 } }}
      />

      {bandName.trim() !== '' && (
        <Stack spacing={0.5}>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t($ => $.band.slugPreview, { slug })}
          </Typography>
          {resumedSlug === null && (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {t($ => $.band.slugCaveat, { slug })}
            </Typography>
          )}
        </Stack>
      )}

      <Stack spacing={1}>
        <Typography variant="body2">{t($ => $.band.logoLabel)}</Typography>
        {logoError && <Alert severity="error" onClose={() => setLogoError(null)}>{logoError}</Alert>}
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          {logoFile && logoPreviewUrl && (
            // Same sizing/objectFit as the logo on the band profile card, so
            // what you crop here is exactly what you'll see there.
            <Box sx={{ position: 'relative', display: 'inline-flex' }}>
              <Box
                component="img"
                src={logoPreviewUrl}
                alt={logoFile.name}
                sx={{ maxWidth: 140, maxHeight: 80, objectFit: 'contain', display: 'block' }}
              />
              {crop.uploading && (
                <Box sx={{
                  position: 'absolute', inset: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  bgcolor: 'rgba(0,0,0,0.4)', borderRadius: '4px',
                }}>
                  <CircularProgress size={20} sx={{ color: '#fff' }} />
                </Box>
              )}
            </Box>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={crop.handleFileChange}
          />
          <Button variant="outlined" onClick={() => fileInputRef.current?.click()}>
            {t($ => $.band.uploadLogo)}
          </Button>
          {logoFile && (
            <Button onClick={() => onLogoFileChange(null)}>{t($ => $.band.removeLogo)}</Button>
          )}
        </Stack>
      </Stack>

      <ImageCropDialog
        open={crop.cropOpen}
        imageSrc={crop.cropSrc}
        title={t($ => $.crop.logo, { ns: 'profile' })}
        onConfirm={crop.handleCropConfirm}
        onCancel={crop.handleCropCancel}
      />
    </Stack>
  )
}
