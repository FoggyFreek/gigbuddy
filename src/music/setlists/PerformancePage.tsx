import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { ThemeProvider } from '@mui/material/styles'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import CloseIcon from '@mui/icons-material/Close'
import DarkModeIcon from '@mui/icons-material/DarkMode'
import FullscreenIcon from '@mui/icons-material/Fullscreen'
import LightModeIcon from '@mui/icons-material/LightMode'
import ShuffleIcon from '@mui/icons-material/Shuffle'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import { getSetlistPerformance } from './setlists.ts'
import PerformanceChartSlide from './components/performance/PerformanceChartSlide.tsx'
import PerformancePdfSlide from './components/performance/PerformancePdfSlide.tsx'
import { stepBack, stepForward } from './components/performance/navigation.ts'
import type { Position } from './components/performance/navigation.ts'
import { createAppTheme } from '../../theme.ts'
import { useThemeMode } from '../../contexts/themeModeContext.ts'
import type { ThemeMode } from '../../contexts/themeModeContext.ts'
import type { PerformanceSlide } from '../../types/entities.ts'

// Keys that step the show. Deliberately broad: Bluetooth page-turner pedals
// emit whichever of these their profile happens to be set to, and a musician on
// stage can't be expected to reconfigure one.
const FORWARD_KEYS = new Set(['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'])
const BACK_KEYS = new Set(['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'])

// The event target is an editable field — let it have the key.
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable
    || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

// Keyed on what the show is: switching setlist (or starting set) rebuilds the
// view from scratch rather than leaving slides, position, page counts and the
// error flag from the previous one to be unpicked by hand — a stale position
// would otherwise point past the end of a shorter setlist and render nothing.
export default function PerformancePage() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const startSetId = searchParams.get('set')
  return <PerformanceView key={`${id}:${startSetId ?? ''}`} setlistId={Number(id)} startSetId={startSetId} />
}

interface PerformanceViewProps {
  setlistId: number
  startSetId: string | null
}

function PerformanceView({ setlistId, startSetId }: Readonly<PerformanceViewProps>) {
  const { t } = useTranslation(['setlists', 'common'])
  const navigate = useNavigate()

  const [slides, setSlides] = useState<PerformanceSlide[]>([])
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [pos, setPos] = useState<Position>({ slide: 0, page: 0 })
  const [showControls, setShowControls] = useState(false)
  const [showNotes, setShowNotes] = useState(false)
  // Screenfuls per slide, keyed by item id: 1 until the PDF loads or the chart
  // has been measured.
  const [pageCounts, setPageCounts] = useState<Record<string, number>>({})

  // The stage screen starts in whatever theme the app is already in, and can be
  // flipped from the corner: a dark room wants black, a bright stage or daylit
  // rehearsal room wants white. Local to this view — it never changes the app's
  // own setting.
  const { mode, variant } = useThemeMode()
  const [stageMode, setStageMode] = useState<ThemeMode>(mode)
  const stageTheme = useMemo(() => createAppTheme(stageMode, null, variant), [stageMode, variant])
  const dark = stageMode === 'dark'
  const paper = dark ? '#000' : '#fff'
  const ink = dark ? '#fff' : '#111'
  const scrim = dark ? 'rgba(0, 0, 0, 0.6)' : 'rgba(255, 255, 255, 0.85)'
  const controlScrim = dark ? 'rgba(0, 0, 0, 0.75)' : 'rgba(255, 255, 255, 0.9)'
  const buttonScrim = dark ? 'rgba(0, 0, 0, 0.45)' : 'rgba(255, 255, 255, 0.65)'

  useEffect(() => {
    let active = true
    getSetlistPerformance(setlistId)
      .then((data) => {
        if (!active) return
        const loaded = data.slides ?? []
        setSlides(loaded)
        setName(data.name ?? '')
        // ?set=<id> starts the show partway in (the per-set Start buttons). An
        // unknown or missing set just starts at the top. Wrapping still returns
        // to the first slide of the whole setlist, not of the chosen set.
        const startAt = startSetId
          ? loaded.findIndex((s) => String(s.set_id) === startSetId)
          : -1
        if (startAt > 0) setPos({ slide: startAt, page: 0 })
      })
      .catch(() => { if (active) setFailed(true) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [setlistId, startSetId])

  const pagesOf = useCallback(
    (index: number) => pageCounts[String(slides[index]?.item_id)] ?? 1,
    [pageCounts, slides],
  )

  const goForward = useCallback(() => {
    if (!slides.length) return
    setPos((prev) => stepForward(prev, slides.length, pagesOf(prev.slide)))
  }, [slides.length, pagesOf])

  const goBack = useCallback(() => {
    if (!slides.length) return
    setPos((prev) => stepBack(prev, slides.length, pagesOf))
  }, [slides.length, pagesOf])

  const exit = useCallback(() => {
    navigate(`/setlists/${setlistId}`)
  }, [navigate, setlistId])

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return
      if (FORWARD_KEYS.has(e.key)) {
        e.preventDefault()
        goForward()
      } else if (BACK_KEYS.has(e.key)) {
        e.preventDefault()
        goBack()
      } else if (e.key === 'Home') {
        e.preventDefault()
        setPos({ slide: 0, page: 0 })
      } else if (e.key === 'Escape') {
        exit()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [goForward, goBack, exit])

  // Keep the screen awake for the length of the set. Best-effort: unsupported
  // browsers and rejected requests degrade to an ordinary page, never an error.
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)
  useEffect(() => {
    let released = false
    async function acquire() {
      try {
        if (!navigator.wakeLock || document.visibilityState !== 'visible') return
        wakeLockRef.current = await navigator.wakeLock.request('screen')
      } catch {
        // No wake lock available — the show goes on.
      }
    }
    function handleVisibility() {
      // The lock is dropped whenever the tab is hidden, so re-take it on return.
      if (!released && document.visibilityState === 'visible') void acquire()
    }
    void acquire()
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      released = true
      document.removeEventListener('visibilitychange', handleVisibility)
      void wakeLockRef.current?.release().catch(() => {})
      wakeLockRef.current = null
    }
  }, [])

  function requestFullscreen() {
    void document.documentElement.requestFullscreen?.().catch(() => {})
  }

  const slide = slides[pos.slide]
  const slideKey = String(slide?.item_id)
  const handlePageCount = useCallback((count: number) => {
    setPageCounts((prev) => (prev[slideKey] === count ? prev : { ...prev, [slideKey]: count }))
  }, [slideKey])

  let body
  if (loading) {
    body = (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <CircularProgress />
      </Box>
    )
  } else if (failed || !slides.length) {
    body = (
      <Box sx={{ display: 'grid', placeItems: 'center', height: '100%', gap: 2, p: 3 }}>
        <Alert severity={failed ? 'error' : 'info'}>
          {failed ? t($ => $.perform.loadFailed) : t($ => $.perform.empty)}
        </Alert>
        <Button variant="contained" onClick={exit}>{t($ => $.perform.exit)}</Button>
      </Box>
    )
  } else {
    body = <SlideBody slide={slide} page={pos.page} onPageCount={handlePageCount} />
  }

  const showStage = !loading && !failed && slides.length > 0

  return (
    <ThemeProvider theme={stageTheme}>
      <Box sx={{ position: 'fixed', inset: 0, bgcolor: paper, color: ink, overflow: 'hidden' }}>
        {body}

        {showStage && (
          <>
            {/* Overlay navigation areas. Real buttons, so a tap, a keyboard and a
                screen reader all reach the same actions. */}
            <Box sx={{ position: 'absolute', inset: 0, display: 'flex', zIndex: 1 }}>
              <NavZone flex={3} label={t($ => $.perform.previousAria)} onClick={goBack} />
              <NavZone flex={4} label={t($ => $.perform.toggleControlsAria)} onClick={() => setShowControls((v) => !v)} />
              <NavZone flex={3} label={t($ => $.perform.nextAria)} onClick={goForward} />
            </Box>

            {/* Which set is running. Small and unobtrusive, and transparent to
                pointers so it never eats a tap on the nav zone beneath it. */}
            {slide?.set_name && (
              <Box
                sx={{
                  position: 'absolute',
                  top: 8,
                  left: 8,
                  zIndex: 2,
                  px: 1.25,
                  py: 0.25,
                  borderRadius: 1,
                  bgcolor: scrim,
                  color: ink,
                  pointerEvents: 'none',
                }}
              >
                <Typography variant="caption" sx={{ letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  {slide.set_name}
                </Typography>
              </Box>
            )}

            {/* Always reachable, and above the nav zones so a tap on these
                exits or flips the theme rather than advancing the show. */}
            <Box sx={{ position: 'absolute', top: 8, right: 8, zIndex: 4, display: 'flex', gap: 1 }}>
              {/* Personal notes start hidden: they sit over the foot of the
                  chart and can cover music you need. */}
              <Tooltip title={showNotes ? t($ => $.perform.hideNotes) : t($ => $.perform.showNotes)}>
                <IconButton
                  onClick={() => setShowNotes((v) => !v)}
                  aria-label={showNotes ? t($ => $.perform.hideNotes) : t($ => $.perform.showNotes)}
                  aria-pressed={showNotes}
                  sx={{ color: ink, bgcolor: buttonScrim }}
                >
                  {showNotes ? <VisibilityIcon /> : <VisibilityOffIcon />}
                </IconButton>
              </Tooltip>
              <IconButton
                onClick={() => setStageMode(dark ? 'light' : 'dark')}
                aria-label={dark ? t($ => $.perform.switchToLight) : t($ => $.perform.switchToDark)}
                sx={{ color: ink, bgcolor: buttonScrim }}
              >
                {dark ? <LightModeIcon /> : <DarkModeIcon />}
              </IconButton>
              <IconButton
                onClick={exit}
                aria-label={t($ => $.perform.exit)}
                sx={{ color: ink, bgcolor: buttonScrim }}
              >
                <CloseIcon />
              </IconButton>
            </Box>

            {/* Both notes for this song, stacked at the foot of the screen: the
                player's own note first, then how this song leads into the next. */}
            {((showNotes && slide?.my_note) || slide?.transition_note) && (
              <Box
                sx={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: 0,
                  zIndex: 2,
                  px: 3,
                  py: 1.5,
                  bgcolor: scrim,
                  color: ink,
                  pointerEvents: 'none',
                  textAlign: 'center',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0.5,
                }}
              >
                {showNotes && slide.my_note && (
                  <Typography variant="subtitle1" sx={{ fontStyle: 'italic', opacity: 0.85 }}>
                    {slide.my_note}
                  </Typography>
                )}
                {slide.transition_note && (
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                    {/* Same icon the editor marks a transition with. */}
                    <ShuffleIcon fontSize="small" />
                    <Typography variant="h6" sx={{ fontWeight: 500 }}>
                      {slide.transition_note}
                    </Typography>
                  </Box>
                )}
              </Box>
            )}

            {showControls && (
              <Box
                sx={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  zIndex: 3,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  pl: 2,
                  // Clear of the always-on buttons in the corner.
                  pr: 20,
                  py: 1,
                  bgcolor: controlScrim,
                  color: ink,
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="subtitle1" noWrap>{slide?.title || slide?.label || name}</Typography>
                  <Typography variant="caption" sx={{ opacity: 0.7 }}>
                    {t($ => $.perform.counter, { current: pos.slide + 1, total: slides.length })}
                  </Typography>
                </Box>
                <Box sx={{ flexGrow: 1 }} />
                <IconButton color="inherit" onClick={requestFullscreen} aria-label={t($ => $.perform.fullscreen)}>
                  <FullscreenIcon />
                </IconButton>
                <IconButton color="inherit" onClick={goBack} aria-label={t($ => $.perform.previousAria)}>
                  <ChevronLeftIcon />
                </IconButton>
                <IconButton color="inherit" onClick={goForward} aria-label={t($ => $.perform.nextAria)}>
                  <ChevronRightIcon />
                </IconButton>
              </Box>
            )}
          </>
        )}
      </Box>
    </ThemeProvider>
  )
}

interface NavZoneProps {
  flex: number
  label: string
  onClick: () => void
}

function NavZone({ flex, label, onClick }: Readonly<NavZoneProps>) {
  return (
    <Box
      component="button"
      type="button"
      aria-label={label}
      onClick={onClick}
      sx={{
        flex,
        height: '100%',
        border: 0,
        p: 0,
        bgcolor: 'transparent',
        cursor: 'pointer',
        appearance: 'none',
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -4 },
      }}
    />
  )
}

interface SlideBodyProps {
  slide?: PerformanceSlide
  page: number
  onPageCount: (count: number) => void
}

// Rows with nothing to show still get a slide, so the on-screen position always
// matches the printed setlist.
function SlideBody({ slide, page, onPageCount }: Readonly<SlideBodyProps>) {
  const { t } = useTranslation('setlists')
  if (!slide) return null

  // Keyed by row so moving between two charts (or two PDFs) remounts rather than
  // re-using a component still holding the previous song's measurements.
  if (slide.source_kind === 'chart' && slide.chart_source) {
    return (
      <PerformanceChartSlide
        key={String(slide.item_id)}
        source={slide.chart_source}
        page={page}
        onPageCount={onPageCount}
      />
    )
  }
  if (slide.source_kind === 'document' && slide.document_object_key) {
    return (
      <PerformancePdfSlide
        key={String(slide.item_id)}
        objectKey={slide.document_object_key}
        page={page}
        onPageCount={onPageCount}
      />
    )
  }

  const heading = slide.title || slide.label
    || (slide.item_type === 'pause' ? t($ => $.item.pause) : t($ => $.item.break))
  return (
    <Box sx={{ display: 'grid', placeItems: 'center', height: '100%', textAlign: 'center', p: 4 }}>
      <Box>
        <Typography variant="h2" sx={{ fontWeight: 700 }}>{heading}</Typography>
        {slide.artist && (
          <Typography variant="h5" sx={{ mt: 1, opacity: 0.7 }}>{slide.artist}</Typography>
        )}
        {slide.item_type === 'song' && (
          <Typography variant="body1" sx={{ mt: 3, opacity: 0.5 }}>
            {t($ => $.perform.noSource)}
          </Typography>
        )}
      </Box>
    </Box>
  )
}
