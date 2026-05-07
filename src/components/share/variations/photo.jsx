import {
  calculateTitleFontSize,
  formatGigCity,
  formatEventName,
  formatGigDateShort,
  SHARE_FORMATS,
} from '../../../utils/shareCard.js'
import CardFrame from '../primitives/CardFrame.jsx'
import PhotoBackdrop from '../primitives/PhotoBackdrop.jsx'
import StickerOverlay from '../StickerOverlay.jsx'

const FALLBACK_LOGO = '/share/logo.png'
const WHITE = '#ffffff'
const INK = '#050505'
const PHOTO_FALLBACK = '#171717'

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

function PhotoSquare({ gig, photoSrc, pan = 0, accent, bandName, sticker, stickerPosition, logoSrc, showLogo = true, invertLogo }) {
  const f = SHARE_FORMATS.square
  const date = formatGigDateShort(gig)
  const weekdayShort = date.weekday ? date.weekday.slice(0, 2) : ''
  const dateText = [weekdayShort, date.day, date.month].filter(Boolean).join(' ')
  const eventName = formatEventName(gig)
  const eventCity = formatGigCity(gig)
  const inset = 58
  const dateSize = 48
  const eventSize = 46
  const bandSize = calculateTitleFontSize(bandName, 64, 30)
  const dateRadius = Math.round(dateSize * 0.16)
  const eventRadius = Math.round(eventSize * 0.16)
  const bandRadius = Math.round(bandSize * 0.16)

  return (
    <CardFrame format={f} background={PHOTO_FALLBACK} color={INK}>
      <div data-share-layer="photo" data-pdf-layer="photo" style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
        <PhotoBackdrop src={photoSrc} pan={pan} width={f.width} height={f.height} filter="contrast(1.04) saturate(0.96)" bgColor={PHOTO_FALLBACK} />
      </div>
      <div
        data-pdf-layer="vignette"
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(ellipse at center, transparent 70%, rgba(0,0,0,0.28) 100%)',
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
          height: 390,
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
            top: 64,
            left: '50%',
            width: 320,
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
          style={{ lineHeight: 1.04, letterSpacing: 1, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', zIndex: 1 }}
        >
          {bandName}
        </TextStrip>
        <TextStrip
          size={eventSize}
          radius={`0 ${eventRadius}px ${eventRadius}px ${eventRadius}px`}
          style={{ letterSpacing: 1, transform: 'translateY(-5px)', zIndex: 2, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
        >
          {eventName} | {eventCity}
        </TextStrip>
      </div>
      <div data-pdf-layer="sticker" style={{ position: 'absolute', inset: 0 }}>
        <StickerOverlay sticker={sticker} position={stickerPosition} accent={accent} />
      </div>
    </CardFrame>
  )
}

function PhotoStory({ gig, photoSrc, zoom, pan = 0, accent, bandName, sticker, stickerPosition, logoSrc, showLogo = true, invertLogo }) {
  const f = SHARE_FORMATS.story
  const date = formatGigDateShort(gig)
  const weekdayShort = date.weekday ? date.weekday.slice(0, 2) : ''
  const dateText = [weekdayShort, date.day, date.month].filter(Boolean).join(' ')
  const eventName = formatEventName(gig) 
  const inset = 72
  const dateSize = 52
  const eventSize = 54
  const bandSize = calculateTitleFontSize(bandName, 76, 34)
  const dateRadius = Math.round(dateSize * 0.16)
  const eventRadius = Math.round(eventSize * 0.16)
  const bandRadius = Math.round(bandSize * 0.16)

  return (
    <CardFrame format={f} background={PHOTO_FALLBACK} color={INK}>
      <div data-share-layer="photo" data-pdf-layer="photo" style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
        <PhotoBackdrop src={photoSrc} zoom={zoom} pan={pan} width={f.width} height={f.height} filter="contrast(1.04) saturate(0.96)" bgColor={PHOTO_FALLBACK} />
      </div>
      <div
        data-pdf-layer="vignette"
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(ellipse at center, transparent 70%, rgba(0,0,0,0.28) 100%)',
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
          height: 620,
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
            top: 92,
            left: '50%',
            width: 320,
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
          style={{ lineHeight: 1.04, letterSpacing: 1, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', zIndex: 1 }}
        >
          {bandName}
        </TextStrip>
        <TextStrip
          size={eventSize}
          radius={`0 ${eventRadius}px ${eventRadius}px ${eventRadius}px`}
          style={{ letterSpacing: 1, transform: 'translateY(-5px)', zIndex: 2, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
        >
          {eventName}
        </TextStrip>
      </div>
      <div data-pdf-layer="sticker" style={{ position: 'absolute', inset: 0 }}>
        <StickerOverlay sticker={sticker} position={stickerPosition} accent={accent} />
      </div>
    </CardFrame>
  )
}

export { PhotoSquare as Square, PhotoStory as Story }
