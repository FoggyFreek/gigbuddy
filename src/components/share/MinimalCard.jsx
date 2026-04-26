import { useState } from 'react'
import {
  formatGigCity,
  formatGigDateShort,
  formatGigDoorsTime,
  formatGigVenueName,
  SHARE_FORMATS,
  SHARE_LOGO,
} from '../../utils/shareCard.js'

const PAPER = '#f4efe6'
const INK = '#111111'
const SUBTLE = '#6b6259'

function PhotoFrame({ src, pan = 0, style }) {
  const [natural, setNatural] = useState(null)

  if (!src) {
    return <div style={{ ...style, background: '#22201d' }} />
  }

  // resolve the container's pixel dimensions from the style object
  const containerW = style?.width ?? 0
  const containerH = style?.height ?? 0

  let imgStyle
  if (natural && containerW && containerH) {
    const scale = Math.max(containerW / natural.w, containerH / natural.h)
    const scaledW = natural.w * scale
    const overflow = Math.max(0, scaledW - containerW)
    const translateX = (pan / 100) * (overflow / 2)
    imgStyle = {
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: scaledW,
      height: natural.h * scale,
      transform: `translate(calc(-50% + ${translateX}px), -50%)`,
      filter: 'contrast(1.05) saturate(0.92)',
    }
  } else {
    imgStyle = {
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      filter: 'contrast(1.05) saturate(0.92)',
    }
  }

  return (
    <div style={{ ...style, position: 'absolute', overflow: 'hidden', background: '#22201d' }}>
      <img
        src={src}
        alt=""
        crossOrigin="anonymous"
        onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        style={imgStyle}
      />
    </div>
  )
}

function Hairline({ accent, style }) {
  return <div style={{ background: accent, height: 4, ...style }} />
}

function SmallCaps({ children, color = INK, size = 22, gap = 4, style }) {
  return (
    <div
      style={{
        fontFamily: 'system-ui, -apple-system, "Helvetica Neue", sans-serif',
        fontSize: size,
        letterSpacing: gap,
        textTransform: 'uppercase',
        fontWeight: 600,
        color,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

function MinimalSquare({ gig, photoSrc, pan = 0, accent }) {
  const date = formatGigDateShort(gig)
  const time = formatGigDoorsTime(gig)
  const venueName = formatGigVenueName(gig)
  const city = formatGigCity(gig)
  const title = gig?.event_description || ''
  const f = SHARE_FORMATS.square

  return (
    <div
      style={{
        position: 'relative',
        width: f.width,
        height: f.height,
        background: PAPER,
        overflow: 'hidden',
        color: INK,
      }}
    >
      {/* Right-side accent block */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          width: 420,
          background: accent,
        }}
      />
      {/* Photo inset — top right inside accent block */}
      <PhotoFrame
        src={photoSrc}
        pan={pan}
        style={{
          position: 'absolute',
          top: 0,
          left: 670,
          width: 1080,
          height: 1080,
        }}
      />

      {/* Top-left "LIVE" eyebrow */}
      <SmallCaps
        color={SUBTLE}
        size={26}
        gap={10}
        style={{ position: 'absolute', top: 236, left: 400 }}
      >
        Live
      </SmallCaps>

      {/* Day numeral huge */}
      <div
        style={{
          position: 'absolute',
          top: 360,
          left: 70,
          fontFamily: '"Cooper Black", Georgia, serif',
          fontSize: 320,
          lineHeight: 0.85,
          color: INK,
          letterSpacing: -10,
        }}
      >
        {date.day}
      </div>
      <SmallCaps
        size={32}
        gap={8}
        style={{ position: 'absolute', top: 640, left: 84 }}
      >
        {date.month} · {date.weekday}
      </SmallCaps>

      {/* Title — left side */}
      {title && (
        <div
          style={{
            position: 'absolute',
            top: 700,
            left: 80,
            right: 480,
            fontFamily: '"Cooper Black", Georgia, serif',
            fontSize: 78,
            lineHeight: 1.0,
            color: INK,
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {title}
        </div>
      )}

      {/* Bottom-left info stack */}
      <div
        style={{
          position: 'absolute',
          left: 80,
          right: 480,
          bottom: 80,
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
        }}
      >
        <Hairline accent={accent} style={{ width: 80 }} />
        {venueName && (
          <div
            style={{
              fontFamily: '"Cooper Black", Georgia, serif',
              fontSize: 38,
              lineHeight: 1.1,
            }}
          >
            {venueName}
          </div>
        )}
        {city && (
          <SmallCaps color={SUBTLE} size={22} gap={6}>
            {city}
          </SmallCaps>
        )}
      </div>

      {/* Right column inside accent block — vertical info */}
      <div
        style={{
          position: 'absolute',
          right: 70,
          bottom: 80,
          width: 280,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          color: INK,
        }}
      >
        <SmallCaps size={20} gap={8} color="rgba(255, 255, 255, 0.65)">
          Showtime
        </SmallCaps>
        {time && (
          <div
            style={{
              fontFamily: '"Cooper Black", Georgia, serif',
              fontSize: 66,
              color: 'rgba(255, 255, 255, 0.9)',
              lineHeight: 0.9,
            }}
          >
            {time}
          </div>
        )}
        
        
      </div>

      {/* Logo top left */}
      <img
        src={SHARE_LOGO}
        alt=""
        crossOrigin="anonymous"
        style={{
          position: 'absolute',
          top: 40,
          left: 60,
          width: 530,
          height: 'auto',
          opacity: 0.85,
          filter: 'invert(1)',
        }}
      />
    </div>
  )
}

function MinimalStory({ gig, photoSrc, pan = 0, accent }) {
  const date = formatGigDateShort(gig)
  const venueName = formatGigVenueName(gig)
  const city = formatGigCity(gig)
  const title = gig?.event_description || ''
  const f = SHARE_FORMATS.story

  return (
    <div
      style={{
        position: 'relative',
        width: f.width,
        height: f.height,
        background: PAPER,
        overflow: 'hidden',
        color: INK,
      }}
    >
      {/* Photo centered in top panel */}
      <PhotoFrame
        src={photoSrc}
        pan={pan}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          width: 1080,
          height: 1200,
        }}
      />

      {/* Eyebrow above photo */}
      <SmallCaps
        size={42}
        gap={16}
        color="rgba(255, 255, 255, 0.7)"
        style={{ position: 'absolute', top: 150, left: 0, right: 0, textAlign: 'center' }}
      >
        Live
        </SmallCaps>

      {/* Day numeral huge in cream area, overlapping photo edge */}
      <div
        style={{
          position: 'absolute',
          top: 970,
          left: 80,
          fontFamily: '"Cooper Black", Georgia, serif',
          fontSize: 360,
          lineHeight: 0.85,
          color: accent,
          letterSpacing: -10,
        }}
      >
        {date.day}
      </div>
      <SmallCaps
        size={42}
        gap={10}
        style={{ position: 'absolute', top: 1300, left: 92 }}
      >
        {date.month} · {date.weekday}
      </SmallCaps>

      {/* Title */}
      {title && (
        <div
          style={{
            position: 'absolute',
            top: 1400,
            left: 80,
            right: 80,
            fontFamily: '"Cooper Black", Georgia, serif',
            fontSize: 110,
            lineHeight: 0.95,
            color: INK,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {title}
        </div>
      )}

      {/* Bottom info row */}
      <div
        style={{
          position: 'absolute',
          left: 80,
          right: 80,
          bottom: 130,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          gap: 24,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <SmallCaps size={28} gap={8} color={SUBTLE}>Venue</SmallCaps>
          <div style={{ fontFamily: '"Cooper Black", Georgia, serif', fontSize: 56, lineHeight: 1.05 }}>
            {venueName}
          </div>
          {city && (
            <SmallCaps size={26} gap={6} color={SUBTLE}>
              {city}
            </SmallCaps>
          )}
        </div>
        
      </div>

      {/* Logo top */}
      <img
        src={SHARE_LOGO}
        alt=""
        crossOrigin="anonymous"
        style={{
          position: 'absolute',
          top: 30,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 310,
          height: 'auto',
        }}
      />
    </div>
  )
}

export default function MinimalCard({ gig, photoSrc, format, pan, accent }) {
  return format === 'story'
    ? <MinimalStory gig={gig} photoSrc={photoSrc} pan={pan} accent={accent} />
    : <MinimalSquare gig={gig} photoSrc={photoSrc} pan={pan} accent={accent} />
}
