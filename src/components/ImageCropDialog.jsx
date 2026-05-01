import { useEffect, useMemo, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Slider from '@mui/material/Slider'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'

const DISPLAY_SIZE = 420
const OUTPUT_SIZE = 1080
const ZOOM_FACTOR = 4  // slider at ±100 = ×4 or ÷4 relative to fit

function getFitScale(naturalW, naturalH, displaySize) {
  return Math.min(displaySize / naturalW, displaySize / naturalH)
}

function sliderToScale(fit, v) {
  return fit * Math.pow(ZOOM_FACTOR, v / 100)
}

function clampOffset(x, y, scaledW, scaledH, displaySize) {
  const maxX = Math.max(0, (scaledW - displaySize) / 2)
  const maxY = Math.max(0, (scaledH - displaySize) / 2)
  return {
    x: Math.max(-maxX, Math.min(maxX, x)),
    y: Math.max(-maxY, Math.min(maxY, y)),
  }
}

function CropContent({ imageSrc, onConfirm, onCancel }) {
  const imgRef = useRef(null)
  const [natural, setNatural] = useState(null)
  const [displaySize, setDisplaySize] = useState(DISPLAY_SIZE)
  const [sliderVal, setSliderVal] = useState(0)
  const [offset, setOffset] = useState({ x: 0, y: 0 })

  useEffect(() => {
    function updateDisplaySize() {
      setDisplaySize(Math.min(DISPLAY_SIZE, Math.max(240, window.innerWidth - 72)))
    }

    updateDisplaySize()
    window.addEventListener('resize', updateDisplaySize)
    return () => window.removeEventListener('resize', updateDisplaySize)
  }, [])

  const fit = useMemo(() => {
    if (!natural) return 1
    return getFitScale(natural.w, natural.h, displaySize)
  }, [natural, displaySize])

  const currentScale = sliderToScale(fit, sliderVal)
  const scaledW = natural ? natural.w * currentScale : displaySize
  const scaledH = natural ? natural.h * currentScale : displaySize
  const hasTransparency = natural && (scaledW < displaySize || scaledH < displaySize)

  function handleSlider(_, v) {
    if (!natural) return
    const newScale = sliderToScale(fit, v)
    const newW = natural.w * newScale
    const newH = natural.h * newScale
    setSliderVal(v)
    setOffset((prev) => clampOffset(prev.x, prev.y, newW, newH, displaySize))
  }

  function handlePointerDown(e) {
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    const ox = offset.x
    const oy = offset.y
    const snapW = scaledW
    const snapH = scaledH

    function onMove(me) {
      setOffset(clampOffset(ox + me.clientX - startX, oy + me.clientY - startY, snapW, snapH, displaySize))
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  function handleConfirm() {
    if (!imgRef.current || !natural) return
    const canvas = document.createElement('canvas')
    canvas.width = OUTPUT_SIZE
    canvas.height = OUTPUT_SIZE
    const ctx = canvas.getContext('2d')

    const outputScale = OUTPUT_SIZE / displaySize
    const drawW = scaledW * outputScale
    const drawH = scaledH * outputScale
    const drawX = OUTPUT_SIZE / 2 + offset.x * outputScale - drawW / 2
    const drawY = OUTPUT_SIZE / 2 + offset.y * outputScale - drawH / 2

    ctx.drawImage(imgRef.current, drawX, drawY, drawW, drawH)
    canvas.toBlob((blob) => { if (blob) onConfirm(blob) }, 'image/png')
  }

  return (
    <>
      <DialogContent>
        <Stack spacing={2} alignItems="center">
          <Typography variant="caption" color="text.secondary">
            Drag to reposition · Zoom out for transparent padding
          </Typography>
          <Box
            sx={{
              width: displaySize,
              height: displaySize,
              position: 'relative',
              overflow: 'hidden',
              background: hasTransparency
                ? 'repeating-conic-gradient(#bbb 0% 25%, #fff 0% 50%) 0 0 / 20px 20px'
                : '#000',
              borderRadius: 1,
              cursor: 'grab',
              '&:active': { cursor: 'grabbing' },
              userSelect: 'none',
              touchAction: 'none',
            }}
            onPointerDown={handlePointerDown}
          >
            {imageSrc && (
              <img
                ref={imgRef}
                src={imageSrc}
                alt=""
                crossOrigin="anonymous"
                draggable={false}
                onLoad={(e) =>
                  setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
                }
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  width: scaledW,
                  height: scaledH,
                  transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
                  pointerEvents: 'none',
                  userSelect: 'none',
                }}
              />
            )}
          </Box>
          <Box sx={{ width: displaySize, px: 1 }}>
            <Slider
              value={sliderVal}
              onChange={handleSlider}
              min={-100}
              max={100}
              step={1}
              size="small"
              aria-label="Zoom"
              marks={[
                { value: -100, label: '−' },
                { value: 0, label: 'Fit' },
                { value: 100, label: '+' },
              ]}
            />
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="contained" onClick={handleConfirm} disabled={!natural}>
          Use this crop
        </Button>
      </DialogActions>
    </>
  )
}

export default function ImageCropDialog({ open, imageSrc, onConfirm, onCancel }) {
  return (
    <Dialog open={open} onClose={onCancel} maxWidth="sm">
      <DialogTitle>Crop event banner</DialogTitle>
      {/* key resets all crop state when a new image is loaded */}
      <CropContent key={imageSrc || ''} imageSrc={imageSrc} onConfirm={onConfirm} onCancel={onCancel} />
    </Dialog>
  )
}
