import { useState } from 'react'
import {
  formatGigCity,
  formatGigDateShort,
  formatGigDoorsTime,
  formatGigVenueName,
  SHARE_FORMATS,
} from '../../utils/shareCard.js'

const FALLBACK_LOGO = '/share/logo.png'
import SocialsRow from './SocialsRow.jsx'
import StickerOverlay from './StickerOverlay.jsx'

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

function SmallCaps({ children, color = INK, size = 22, gap = 4, style, ...rest }) {
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
      {...rest}
    >
      {children}
    </div>
  )
}

function MinimalSquare({ gig, photoSrc, pan = 0, accent, socials, sticker, stickerPosition, logoSrc }) {
  const date = formatGigDateShort(gig)
  const time = formatGigDoorsTime(gig)
  const venueName = formatGigVenueName(gig)
  const city = formatGigCity(gig)
  const title = gig?.event_description || ''
  const f = SHARE_FORMATS.square

  return (
    <div
      data-share-frame
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
        data-pdf-layer="accent"
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
      <div data-share-layer="photo" data-pdf-layer="photo" style={{ position: 'absolute', top: 0, left: 670, width: 1080, height: 1080 }}><PhotoFrame
        src={photoSrc}
        pan={pan}
        style={{
          position: 'absolute',
          top: 0,
          left: 670,
          width: 1080,
          height: 1080,
        }}
      /></div>

      {/* Top-left "LIVE" eyebrow */}
      <SmallCaps
        data-pdf-layer="live"
        color={SUBTLE}
        size={26}
        gap={10}
        style={{ position: 'absolute', top: 236, left: 400 }}
      >
        Live
      </SmallCaps>

      {/* Day numeral huge */}
      <div
        data-pdf-layer="date-day"
        style={{
          position: 'absolute',
          top: 300,
          left: 70,
          fontFamily: '"Cooper Black", Georgia, serif',
          fontSize: 280,
          lineHeight: 0.85,
          color: accent,
          letterSpacing: -10,
        }}
      >
        {date.day}
      </div>
      <SmallCaps
        data-pdf-layer="date-month"
        size={52}
        gap={8}
        style={{ position: 'absolute', top: 530, left: 84 }}
      >
        {date.month}
      </SmallCaps>

      {/* Title — left side */}
      {title && (
        <div
          data-pdf-layer="title"
          style={{
            position: 'absolute',
            top: 600,
            left: 80,
            right: 420,
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
        data-pdf-layer="venue-info"
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
        <SocialsRow socials={socials} iconColor={accent} textColor={SUBTLE} size={26} justify="flex-start" />
      </div>

      {/* Right column inside accent block — vertical info */}
      <div
        data-pdf-layer="showtime"
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
        data-pdf-layer="logo"
        src={logoSrc || FALLBACK_LOGO}
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
      <div data-pdf-layer="sticker" style={{ position: 'absolute', inset: 0 }}><StickerOverlay sticker={sticker} position={stickerPosition} accent={accent} /></div>
    </div>
  )
}

function MinimalStory({ gig, photoSrc, pan = 0, accent, socials, sticker, stickerPosition, logoSrc }) {
  const date = formatGigDateShort(gig)
  const venueName = formatGigVenueName(gig)
  const city = formatGigCity(gig)
  const title = gig?.event_description || ''
  const f = SHARE_FORMATS.story

  return (
    <div
      data-share-frame
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
      <div data-share-layer="photo" data-pdf-layer="photo" style={{ position: 'absolute', top: 0, left: 0, width: 1080, height: 1200 }}><PhotoFrame
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
      /></div>

      {/* Eyebrow above photo */}
      <SmallCaps
        data-pdf-layer="live"
        size={42}
        gap={16}
        color="rgba(255, 255, 255, 0.7)"
        style={{ position: 'absolute', top: 150, left: 0, right: 0, textAlign: 'center' }}
      >
        Live
      </SmallCaps>

      {/* Day numeral huge in cream area, overlapping photo edge */}
      <div
        data-pdf-layer="date-day"
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
        data-pdf-layer="date-month"
        size={42}
        gap={10}
        style={{ position: 'absolute', top: 1300, left: 92 }}
      >
        {date.month} · {date.weekday}
      </SmallCaps>

      {/* Title */}
      {title && (
        <div
          data-pdf-layer="title"
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
        data-pdf-layer="venue-info"
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
          <div style={{ fontFamily: '"Cooper Black", Georgia, serif', fontSize: 56, lineHeight: 1.05 }}>
            {venueName}
          </div>
          {city && (
            <SmallCaps size={26} gap={6} color={SUBTLE}>
              {city}
            </SmallCaps>
          )}
          <SocialsRow socials={socials} iconColor={accent} textColor={SUBTLE} size={26} justify="flex-start" />
        </div>

      </div>

      {/* Logo top */}
      <img
        data-pdf-layer="logo"
        src={logoSrc || FALLBACK_LOGO}
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
      <div data-pdf-layer="sticker" style={{ position: 'absolute', inset: 0 }}><StickerOverlay sticker={sticker} position={stickerPosition} accent={accent} /></div>
    </div>
  )
}

export default function MinimalCard({ gig, photoSrc, format, pan, accent, socials, sticker, stickerPosition, logoSrc }) {
  return format === 'story'
    ? <MinimalStory gig={gig} photoSrc={photoSrc} pan={pan} accent={accent} socials={socials} sticker={sticker} stickerPosition={stickerPosition} logoSrc={logoSrc} />
    : <MinimalSquare gig={gig} photoSrc={photoSrc} pan={pan} accent={accent} socials={socials} sticker={sticker} stickerPosition={stickerPosition} logoSrc={logoSrc} />
}
