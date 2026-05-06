import { useState } from 'react'
import { calculateTitleFontSize, formatGigDateShort, SHARE_FORMATS } from '../../utils/shareCard.js'
import StickerOverlay from './StickerOverlay.jsx'

const WHITE = '#ffffff'
const INK = '#050505'
const PHOTO_FALLBACK = '#171717'
const FALLBACK_LOGO = '/share/logo.png'

function PhotoFrame({ src, zoom, pan = 0, format }) {
  const [natural, setNatural] = useState(null)
  const f = SHARE_FORMATS[format] || SHARE_FORMATS.square

  if (!src) {
    return <div style={{ position: 'absolute', inset: 0, background: PHOTO_FALLBACK }} />
  }

  let imgStyle
  if (natural) {
    const scaleWidth = f.width / natural.w
    const scaleHeight = f.height / natural.h
    const scale = zoom != null
      ? scaleWidth + (scaleHeight - scaleWidth) * (zoom / 100)
      : Math.max(scaleWidth, scaleHeight)
    const scaledW = natural.w * scale
    const overflow = Math.max(0, scaledW - f.width)
    const translateX = (pan / 100) * (overflow / 2)
    imgStyle = {
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: scaledW,
      height: natural.h * scale,
      transform: `translate(calc(-50% + ${translateX}px), -50%)`,
      filter: 'contrast(1.04) saturate(0.96)',
    }
  } else {
    imgStyle = {
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      filter: 'contrast(1.04) saturate(0.96)',
    }
  }

  return (
    <img
      src={src}
      alt=""
      crossOrigin="anonymous"
      onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
      style={imgStyle}
    />
  )
}

function TextStrip({ children, color = INK, background = WHITE, size, radius, style }) {
  if (!children) return null
  const borderRadius = radius ?? Math.round(size * 0.16)

  return (
    <div
      style={{
        display: 'inline-block',
        alignSelf: 'flex-start',
        maxWidth: '100%',
        background,
        color,
        fontFamily: '"Cooper Black", Georgia, serif',
        fontSize: size,
        lineHeight: 1,
        padding: `${Math.round(size * 0.22)}px ${Math.round(size * 0.34)}px ${Math.round(size * 0.28)}px`,
        borderRadius,
        boxDecorationBreak: 'clone',
        WebkitBoxDecorationBreak: 'clone',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

function PhotoLayout({ gig, photoSrc, format, zoom, pan = 0, accent, bandName, sticker, stickerPosition, logoSrc, showLogo = true, invertLogo }) {
  const f = SHARE_FORMATS[format] || SHARE_FORMATS.square
  const date = formatGigDateShort(gig)
  const weekdayShort = date.weekday ? date.weekday.slice(0, 2) : ''
  const dateText = [weekdayShort, date.day, date.month].filter(Boolean).join(' ')
  const eventName = gig?.event_description || ''
  const isStory = format === 'story'
  const inset = isStory ? 72 : 58
  const dateSize = isStory ? 52 : 42
  const eventSize = isStory ? 54 : 46
  const bandSize = calculateTitleFontSize(bandName, isStory ? 76 : 64, isStory ? 34 : 30)
  const dateRadius = Math.round(dateSize * 0.16)
  const eventRadius = Math.round(eventSize * 0.16)
  const bandRadius = Math.round(bandSize * 0.16)

  return (
    <div
      data-share-frame
      style={{
        position: 'relative',
        width: f.width,
        height: f.height,
        overflow: 'hidden',
        background: PHOTO_FALLBACK,
        color: INK,
      }}
    >
      <div data-share-layer="photo" data-pdf-layer="photo" style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
        <PhotoFrame src={photoSrc} zoom={zoom} pan={pan} format={format} />
      </div>

      <div
        data-pdf-layer="vignette"
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(ellipse at center, transparent 70%, rgba(0,0,0,0.28) 100%)',
          pointerEvents: 'none',
        }}
      />

      <div
        data-pdf-layer="text-shadow"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: isStory ? 620 : 390,
          background: 'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.28) 100%)',
          pointerEvents: 'none',
        }}
      />

      {showLogo && (
        <img
          data-pdf-layer="logo"
          src={logoSrc || FALLBACK_LOGO}
          alt=""
          crossOrigin="anonymous"
          style={{
            position: 'absolute',
            top: isStory ? 92 : 64,
            left: '50%',
            width: isStory ? 320 : 240,
            height: 'auto',
            transform: 'translateX(-50%)',
            filter: `${invertLogo ? 'invert(1) ' : ''}drop-shadow(0 3px 10px rgba(0,0,0,0.55))`,
          }}
        />
      )}

      <div
        data-pdf-layer="text"
        style={{
          position: 'absolute',
          left: inset,
          right: inset,
          bottom: inset,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: 0,
          textTransform: 'uppercase',
        }}
      >
        <TextStrip
          color={WHITE}
          background={accent}
          size={dateSize}
          radius={`${dateRadius}px ${dateRadius}px ${dateRadius}px 0`}
          style={{ letterSpacing: 2, transform: 'translateY(5px)', zIndex: 0 }}
        >
          {dateText}
        </TextStrip>
        <TextStrip
          size={bandSize}
          radius={`0 ${bandRadius}px ${bandRadius}px 0`}
          style={{
            lineHeight: 1.04,
            letterSpacing: 1,
            display: '-webkit-box',
            WebkitLineClamp: isStory ? 3 : 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            zIndex: 1,
          }}
        >
          {bandName}
        </TextStrip>
        <TextStrip
          size={eventSize}
          radius={`0 ${eventRadius}px ${eventRadius}px ${eventRadius}px`}
          style={{
            letterSpacing: 1,
            transform: 'translateY(-5px)',
            zIndex: 2,
            display: '-webkit-box',
            WebkitLineClamp: isStory ? 3 : 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {eventName}
        </TextStrip>
      </div>

      <div data-pdf-layer="sticker" style={{ position: 'absolute', inset: 0 }}>
        <StickerOverlay sticker={sticker} position={stickerPosition} accent={accent} />
      </div>
    </div>
  )
}

export default function PhotoCard({ gig, photoSrc, format = 'square', zoom, pan, accent, bandName, sticker, stickerPosition, logoSrc, showLogo, invertLogo }) {
  return (
    <PhotoLayout
      gig={gig}
      photoSrc={photoSrc}
      format={format}
      zoom={format === 'story' ? zoom : undefined}
      pan={pan}
      accent={accent}
      bandName={bandName}
      sticker={sticker}
      stickerPosition={stickerPosition}
      logoSrc={logoSrc}
      showLogo={showLogo}
      invertLogo={invertLogo}
    />
  )
}
