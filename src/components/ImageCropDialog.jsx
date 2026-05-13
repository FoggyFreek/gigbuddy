import { useCallback, useRef, useState } from 'react'
import ReactCrop, { centerCrop, makeAspectCrop } from 'react-image-crop'
import 'react-image-crop/dist/ReactCrop.css'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

function getInitialCrop(naturalWidth, naturalHeight) {
  // Start with 100% of the image selected (no crop applied by default)
  return centerCrop(
    makeAspectCrop({ unit: '%', width: 100 }, naturalWidth / naturalHeight, naturalWidth, naturalHeight),
    naturalWidth,
    naturalHeight,
  )
}

function cropToBlob(imgEl, crop) {
  return new Promise((resolve, reject) => {
    const { naturalWidth, naturalHeight } = imgEl

    const srcX = (crop.x / 100) * naturalWidth
    const srcY = (crop.y / 100) * naturalHeight
    const srcW = (crop.width / 100) * naturalWidth
    const srcH = (crop.height / 100) * naturalHeight

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(srcW)
    canvas.height = Math.round(srcH)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(imgEl, srcX, srcY, srcW, srcH, 0, 0, canvas.width, canvas.height)
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas toBlob failed'))), 'image/png')
  })
}

function CropContent({ imageSrc, onConfirm, onCancel }) {
  const imgRef = useRef(null)
  const [crop, setCrop] = useState()
  const [completedCrop, setCompletedCrop] = useState()

  const onImageLoad = useCallback((e) => {
    const { naturalWidth, naturalHeight } = e.currentTarget
    setCrop(getInitialCrop(naturalWidth, naturalHeight))
  }, [])

  async function handleConfirm() {
    if (!imgRef.current || !completedCrop) return
    const blob = await cropToBlob(imgRef.current, completedCrop)
    onConfirm(blob)
  }

  return (
    <>
      <DialogContent>
        <Stack spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="caption" color="text.secondary">
            Drag the handles to adjust the crop area
          </Typography>
          <Box
            sx={{
              background: 'repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 0 0 / 20px 20px',
              borderRadius: 1,
              lineHeight: 0,
            }}
          >
            <ReactCrop
              crop={crop}
              onChange={(_, pct) => setCrop(pct)}
              onComplete={(_, pct) => setCompletedCrop(pct)}
              minWidth={10}
              minHeight={10}
              style={{ maxWidth: '100%', maxHeight: '70vh' }}
            >
              <img
                ref={imgRef}
                src={imageSrc}
                alt=""
                crossOrigin="anonymous"
                onLoad={onImageLoad}
                style={{ maxWidth: '100%', maxHeight: '70vh', display: 'block' }}
              />
            </ReactCrop>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="contained" onClick={handleConfirm} disabled={!completedCrop}>
          Use this crop
        </Button>
      </DialogActions>
    </>
  )
}

export default function ImageCropDialog({ open, imageSrc, onConfirm, onCancel, title = 'Crop image' }) {
  return (
    <Dialog open={open} onClose={onCancel} maxWidth="md" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      {/* key resets all crop state when a new image is loaded */}
      <CropContent key={imageSrc || ''} imageSrc={imageSrc} onConfirm={onConfirm} onCancel={onCancel} />
    </Dialog>
  )
}
