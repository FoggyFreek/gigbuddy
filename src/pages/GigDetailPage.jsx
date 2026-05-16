import { useEffect, useRef, useState } from 'react'
import { useNavigate, useOutletContext, useParams } from 'react-router-dom'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CloseIcon from '@mui/icons-material/Close'
import GigDetailContent from '../components/GigDetailContent.jsx'

export default function GigDetailPage() {
  const { id } = useParams()
  const gigId = Number(id)
  const navigate = useNavigate()
  const outletCtx = useOutletContext() || {}
  const insideSplitView = !!outletCtx.insideSplitView

  const contentRef = useRef()
  const [saveLabel, setSaveLabel] = useState('')
  const [saveColor, setSaveColor] = useState('text.secondary')

  useEffect(() => {
    const interval = setInterval(() => {
      const status = contentRef.current?.saveStatus
      setSaveLabel({ idle: '', saving: 'Saving…', saved: 'Saved', error: 'Save failed' }[status] ?? '')
      setSaveColor(status === 'error' ? 'error.main' : 'text.secondary')
    }, 100)
    return () => clearInterval(interval)
  }, [])

  async function handleBack() {
    await contentRef.current?.flush()
    if (outletCtx.onClose) outletCtx.onClose()
    else navigate(-1)
  }

  return (
    <Box sx={{ maxWidth: insideSplitView ? '100%' : 800, mx: insideSplitView ? 0 : 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
        {!insideSplitView && (
          <IconButton onClick={handleBack} aria-label="back">
            <ArrowBackIcon />
          </IconButton>
        )}
        <Typography variant="h5" fontWeight={600}>Gig details</Typography>
        {insideSplitView && (
          <>
            <Box sx={{ flexGrow: 1 }} />
            <IconButton onClick={handleBack} aria-label="close">
              <CloseIcon />
            </IconButton>
          </>
        )}
      </Box>

      <GigDetailContent
        ref={contentRef}
        gigId={gigId}
        onBannerUpdate={outletCtx.onGigUpdate}
      />

      <Box sx={{ mt: 2, display: 'flex', alignItems: 'center' }}>
        <Typography variant="caption" color={saveColor}>{saveLabel}</Typography>
      </Box>
    </Box>
  )
}
