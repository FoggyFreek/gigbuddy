import { useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { Document, Page, pdfjs } from 'react-pdf'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import CloudUploadOutlinedIcon from '@mui/icons-material/CloudUploadOutlined'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import RotateRightIcon from '@mui/icons-material/RotateRight'
import ZoomInIcon from '@mui/icons-material/ZoomIn'
import ZoomOutIcon from '@mui/icons-material/ZoomOut'
import { purchaseAttachmentShape } from '../../propTypes/shared.js'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

const ACCEPT = 'application/pdf,image/png,image/jpeg'
const ALLOWED_TYPES = new Set(ACCEPT.split(','))
const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3]

function clampIndex(index, length) {
  if (!length) return 0
  return Math.min(Math.max(index, 0), length - 1)
}

const pdfLoadingSpinner = (
  <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
    <CircularProgress size={24} />
  </Box>
)

// Step back through the flattened page sequence: previous page, else the last
// page of the previous attachment. queueMicrotask defers the page jump past the
// on-switch reset that returns page to 1.
function stepBack({ page, safeIndex, attachments, pagesOf, setPage, setIndex }) {
  if (page > 1) {
    setPage(page - 1)
  } else if (safeIndex > 0) {
    const prev = attachments[safeIndex - 1]
    setIndex(safeIndex - 1)
    queueMicrotask(() => setPage(pagesOf(prev)))
  }
}

// Step forward: next page, else the first page of the next attachment.
function stepForward({ page, currentPages, safeIndex, attachments, setPage, setIndex }) {
  if (page < currentPages) setPage(page + 1)
  else if (safeIndex < attachments.length - 1) setIndex(safeIndex + 1)
}

// Receipt viewer. One prev/next control paginates through every page of every
// attachment in sequence (PDF pages expand in place once their document loads).
// Zoom/rotate re-render PDF pages via pdf.js; images use CSS transforms.
export default function PurchaseAttachmentsViewer({ attachments, busy, error, onUpload, onDelete }) {
  const [index, setIndex] = useState(0)
  const [page, setPage] = useState(1)
  const [zoomStep, setZoomStep] = useState(2) // index into ZOOM_STEPS → 100%
  const [rotation, setRotation] = useState(0)
  const [menuAnchor, setMenuAnchor] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  // Page counts per attachment id, filled in as each PDF loads (images count 1).
  const [numPagesById, setNumPagesById] = useState({})
  const fileInputRef = useRef(null)
  const viewportRef = useRef(null)
  const [viewportWidth, setViewportWidth] = useState(null)

  const safeIndex = clampIndex(index, attachments.length)
  const current = attachments[safeIndex] || null
  const isPdf = current?.content_type === 'application/pdf'

  // Reset view transforms and page when switching attachments
  // (adjust-state-during-render pattern, no extra committed render).
  const [viewedId, setViewedId] = useState(current?.id ?? null)
  if ((current?.id ?? null) !== viewedId) {
    setViewedId(current?.id ?? null)
    setZoomStep(2)
    setRotation(0)
    setPage(1)
  }

  useEffect(() => {
    const el = viewportRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver((entries) => {
      setViewportWidth(entries[0].contentRect.width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [current?.id])

  function pagesOf(attachment) {
    return numPagesById[attachment.id] || 1
  }

  const currentPages = current ? pagesOf(current) : 1
  const totalSteps = attachments.reduce((sum, a) => sum + pagesOf(a), 0)
  const currentStep = attachments.slice(0, safeIndex).reduce((sum, a) => sum + pagesOf(a), 0) + page

  function goPrev() {
    stepBack({ page, safeIndex, attachments, pagesOf, setPage, setIndex })
  }

  function goNext() {
    stepForward({ page, currentPages, safeIndex, attachments, setPage, setIndex })
  }

  function handleFilesPicked(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (files.length) onUpload(files)
  }

  function closeMenu() {
    setMenuAnchor(null)
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    if (busy) return
    const files = Array.from(e.dataTransfer?.files || []).filter((f) => ALLOWED_TYPES.has(f.type))
    if (files.length) onUpload(files)
  }

  const dropHandlers = {
    onDragOver: (e) => {
      e.preventDefault()
      setDragOver(true)
    },
    onDragLeave: () => setDragOver(false),
    onDrop: handleDrop,
  }

  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept={ACCEPT}
      multiple
      hidden
      onChange={handleFilesPicked}
    />
  )

  if (!attachments.length) {
    return (
      <Paper
        variant="outlined"
        {...dropHandlers}
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
          p: 4,
          minHeight: 280,
          height: '100%',
          borderStyle: 'dashed',
          borderColor: dragOver ? 'primary.main' : 'divider',
          bgcolor: dragOver ? 'action.hover' : 'transparent',
          transition: 'border-color 0.15s, background-color 0.15s',
        }}
      >
        {fileInput}
        {error && <Alert severity="error" sx={{ alignSelf: 'stretch' }}>{error}</Alert>}
        <CloudUploadOutlinedIcon sx={{ fontSize: 44, color: 'text.secondary' }} />
        <Typography variant="body1" sx={{ textAlign: 'center' }}>
          Drag and drop receipts here
        </Typography>
        <Button
          variant="outlined"
          color="inherit"
          startIcon={busy ? <CircularProgress size={16} /> : null}
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
          sx={{ borderRadius: 99, px: 3, textTransform: 'none', fontWeight: 600 }}
        >
          Upload file
        </Button>
        <Typography variant="caption" color="text.secondary">
          PDF, PNG or JPG
        </Typography>
      </Paper>
    )
  }

  const scale = ZOOM_STEPS[zoomStep]
  const src = `/api/files/${current.object_key}?inline=1`

  const toolbar = (
    <Paper
      elevation={3}
      sx={{
        position: 'absolute',
        bottom: 8,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 2,
        display: 'flex',
        alignItems: 'center',
        gap: 0.25,
        px: 0.75,
        py: 0.25,
        borderRadius: 99,
      }}
    >
      <IconButton
        size="small"
        aria-label="previous attachment"
        disabled={currentStep <= 1}
        onClick={goPrev}
      >
        <ChevronLeftIcon fontSize="small" />
      </IconButton>
      <Typography variant="caption" sx={{ minWidth: 32, textAlign: 'center' }}>
        {currentStep}/{totalSteps}
      </Typography>
      <IconButton
        size="small"
        aria-label="next attachment"
        disabled={currentStep >= totalSteps}
        onClick={goNext}
      >
        <ChevronRightIcon fontSize="small" />
      </IconButton>
      <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
      <IconButton
        size="small"
        aria-label="zoom out"
        disabled={zoomStep === 0}
        onClick={() => setZoomStep((z) => Math.max(z - 1, 0))}
      >
        <ZoomOutIcon fontSize="small" />
      </IconButton>
      <Typography variant="caption" sx={{ minWidth: 36, textAlign: 'center' }}>
        {Math.round(scale * 100)}%
      </Typography>
      <IconButton
        size="small"
        aria-label="zoom in"
        disabled={zoomStep === ZOOM_STEPS.length - 1}
        onClick={() => setZoomStep((z) => Math.min(z + 1, ZOOM_STEPS.length - 1))}
      >
        <ZoomInIcon fontSize="small" />
      </IconButton>
      <Tooltip title="Rotate">
        <IconButton size="small" aria-label="rotate" onClick={() => setRotation((r) => (r + 90) % 360)}>
          <RotateRightIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
      <IconButton size="small" aria-label="attachment options" onClick={(e) => setMenuAnchor(e.currentTarget)}>
        <MoreVertIcon fontSize="small" />
      </IconButton>
    </Paper>
  )

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {fileInput}
      {error && <Alert severity="error">{error}</Alert>}
      <Box
        {...dropHandlers}
        sx={{
          position: 'relative',
          borderRadius: 2,
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: 'action.hover',
          overflow: 'auto',
          minHeight: 320,
          maxHeight: { xs: 378, md: 'calc((100vh - 220px) * 0.9)' },
        }}
      >
        {toolbar}
        <Box
          ref={viewportRef}
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: scale > 1 ? 'flex-start' : 'center',
            p: 2,
            pb: 7,
            minHeight: 320,
          }}
        >
          {isPdf ? (
            <Document
              key={current.id}
              file={src}
              loading={pdfLoadingSpinner}
              error={<Alert severity="error">Could not load this PDF</Alert>}
              onLoadSuccess={({ numPages }) => {
                setNumPagesById((prev) => ({ ...prev, [current.id]: numPages }))
              }}
            >
              <Page
                pageNumber={Math.min(page, currentPages)}
                rotate={rotation}
                width={viewportWidth ? Math.max((viewportWidth - 32) * scale, 200) : undefined}
                renderTextLayer={false}
                renderAnnotationLayer={false}
                loading={pdfLoadingSpinner}
              />
            </Document>
          ) : (
            <Box
              component="img"
              key={current.id}
              src={src}
              alt={current.original_filename}
              sx={{
                maxWidth: rotation % 180 === 0 ? '100%' : undefined,
                width: scale === 1 ? undefined : `${scale * 100}%`,
                transform: rotation ? `rotate(${rotation}deg)` : 'none',
                transformOrigin: 'center center',
                boxShadow: 2,
                bgcolor: 'background.paper',
              }}
            />
          )}
        </Box>
        {busy && (
          <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'rgba(0,0,0,0.2)', zIndex: 3 }}>
            <CircularProgress size={28} />
          </Box>
        )}
      </Box>
      <Typography variant="caption" color="text.secondary" noWrap title={current.original_filename}>
        {current.original_filename}
      </Typography>

      <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={closeMenu}>
        <MenuItem
          onClick={() => {
            closeMenu()
            fileInputRef.current?.click()
          }}
        >
          <ListItemIcon><AddIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Add attachment</ListItemText>
        </MenuItem>
        <MenuItem
          component="a"
          href={`/api/files/${current.object_key}`}
          download={current.original_filename}
          onClick={closeMenu}
        >
          <ListItemIcon><FileDownloadOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Download</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            closeMenu()
            onDelete(current.id)
          }}
        >
          <ListItemIcon><DeleteOutlineIcon fontSize="small" color="error" /></ListItemIcon>
          <ListItemText slotProps={{ primary: { color: 'error' } }}>Delete</ListItemText>
        </MenuItem>
      </Menu>
    </Box>
  )
}

PurchaseAttachmentsViewer.propTypes = {
  attachments: PropTypes.arrayOf(purchaseAttachmentShape).isRequired,
  busy: PropTypes.bool,
  error: PropTypes.string,
  onUpload: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
}
