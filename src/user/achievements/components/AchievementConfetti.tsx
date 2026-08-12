import { useEffect, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import { useTheme } from '@mui/material/styles'

interface AchievementConfettiProps {
  // ISO timestamp of the most recent unlock, or null. A single burst fires when
  // this falls inside the recency window (unlocked in the last 10 seconds).
  recentUnlockAt: string | null
  // Localized, visually hidden text announced to assistive tech on the burst.
  announcement: string
}

// A freshly unlocked achievement is one unlocked within this window of "now".
export const RECENT_WINDOW_MS = 10_000
const DURATION_MS = 2600
const FADE_MS = 800
const PARTICLE_COUNT = 90
const GRAVITY = 0.18
const DRAG = 0.992

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  rot: number
  vr: number
  size: number
  color: string
  round: boolean
}

/**
 * A celebratory confetti burst confined to (localized within) its positioned
 * parent — two poppers fire up and inward from the bottom corners of the card,
 * fall under gravity, and fade out. The canvas is decorative (aria-hidden); the
 * companion live region carries the localized announcement, inserted only when a
 * burst actually fires so assistive tech announces it once. Honors reduced-motion.
 */
export default function AchievementConfetti({ recentUnlockAt, announcement }: Readonly<AchievementConfettiProps>) {
  const theme = useTheme()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [celebrating, setCelebrating] = useState(false)

  useEffect(() => {
    if (!recentUnlockAt) return undefined
    const age = Date.now() - Date.parse(recentUnlockAt)
    if (!(age >= 0 && age < RECENT_WINDOW_MS)) return undefined
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined

    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return undefined

    const parent = canvas.parentElement
    const dpr = window.devicePixelRatio || 1
    const width = parent?.clientWidth ?? canvas.clientWidth
    const height = parent?.clientHeight ?? canvas.clientHeight
    canvas.width = width * dpr
    canvas.height = height * dpr
    ctx.scale(dpr, dpr)

    const colors = [
      theme.palette.primary.main,
      theme.palette.secondary.main,
      theme.palette.success.main,
      theme.palette.warning.main,
      theme.palette.error.main,
      theme.palette.info.main,
    ]

    const particles: Particle[] = Array.from({ length: PARTICLE_COUNT }, (_, i) => {
      const fromLeft = i % 2 === 0
      // Aim up-and-inward: left popper toward top-right, right popper toward top-left.
      const base = fromLeft ? -Math.PI / 3 : (-2 * Math.PI) / 3
      const angle = base + (Math.random() - 0.5) * 0.8
      const speed = 6 + Math.random() * 6
      return {
        x: fromLeft ? width * 0.1 : width * 0.9,
        y: height + 8,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        size: 5 + Math.random() * 5,
        color: colors[i % colors.length],
        round: i % 3 === 0,
      }
    })

    const start = performance.now()
    let raf = 0
    const frame = (t: number) => {
      const elapsed = t - start
      const fade = 1 - Math.max(0, elapsed - (DURATION_MS - FADE_MS)) / FADE_MS
      ctx.clearRect(0, 0, width, height)
      ctx.globalAlpha = Math.max(0, fade)
      for (const p of particles) {
        p.vx *= DRAG
        p.vy = p.vy * DRAG + GRAVITY
        p.x += p.vx
        p.y += p.vy
        p.rot += p.vr
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        ctx.fillStyle = p.color
        if (p.round) {
          ctx.beginPath()
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2)
          ctx.fill()
        } else {
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6)
        }
        ctx.restore()
      }
      if (elapsed < DURATION_MS) {
        raf = requestAnimationFrame(frame)
      } else {
        ctx.clearRect(0, 0, width, height)
      }
    }
    raf = requestAnimationFrame(frame)
    // Insert the announcement asynchronously so the live region change (not a
    // mount-time value) is what assistive tech picks up.
    const announceId = window.setTimeout(() => setCelebrating(true), 0)

    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(announceId)
      ctx.clearRect(0, 0, width, height)
    }
  }, [recentUnlockAt, theme])

  return (
    <>
      <Box
        component="canvas"
        ref={canvasRef}
        aria-hidden="true"
        sx={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 2,
        }}
      />
      <Box
        role="status"
        sx={{
          position: 'absolute',
          width: 1,
          height: 1,
          overflow: 'hidden',
          clip: 'rect(0 0 0 0)',
          whiteSpace: 'nowrap',
        }}
      >
        {celebrating ? announcement : ''}
      </Box>
    </>
  )
}
