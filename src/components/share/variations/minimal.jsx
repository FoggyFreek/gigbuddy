import {
  calculateTitleFontSize,
  formatGigCity,
  formatGigDateShort,
  formatGigDoorsTime,
  formatGigVenueName,
  SHARE_FORMATS,
} from '../../../utils/shareCard.js'
import CardFrame from '../primitives/CardFrame.jsx'
import PhotoBackdrop from '../primitives/PhotoBackdrop.jsx'
import SocialsRow from '../SocialsRow.jsx'
import StickerOverlay from '../StickerOverlay.jsx'

const FALLBACK_LOGO = '/share/logo.png'
const PAPER = '#f4efe6'
const INK = '#111111'
const SUBTLE = '#6b6259'

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

function MinimalSquare({ gig, photoSrc, pan = 0, accent, socials, sticker, stickerPosition, logoSrc, bannerSrc, invertLogo }) {
  const f = SHARE_FORMATS.square
  const date = formatGigDateShort(gig)
  const time = formatGigDoorsTime(gig)
  const venueName = formatGigVenueName(gig)
  const city = formatGigCity(gig)
  const title = gig?.event_description || ''

  return (
    <CardFrame format={f} background={PAPER} color={INK}>
      {/* Right-side accent block */}
      <div
        data-pdf-layer="accent"
        style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 420, background: accent }}
      />
      {/* Photo inset — fills right accent column */}
      <div
        data-share-layer="photo"
        data-pdf-layer="photo"
        style={{ position: 'absolute', top: 0, left: 660, right: 0, bottom: 0, overflow: 'hidden' }}
      >
        <PhotoBackdrop src={photoSrc} pan={pan} width={f.width} height={f.height} filter="contrast(1.05) saturate(0.92)" bgColor="#22201d" />
      </div>

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

      {title && (
        <div
          data-pdf-layer="title"
          style={{
            position: 'absolute',
            top: 600,
            left: 80,
            right: 420,
            fontFamily: '"Cooper Black", Georgia, serif',
            fontSize: calculateTitleFontSize(title, 78, 24),
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
          <div style={{ fontFamily: '"Cooper Black", Georgia, serif', fontSize: 38, lineHeight: 1.1 }}>
            {venueName}
          </div>
        )}
        {city && <SmallCaps color={SUBTLE} size={22} gap={6}>{city}</SmallCaps>}
        <SocialsRow socials={socials} iconColor={accent} textColor={SUBTLE} size={26} justify="flex-start" />
      </div>

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
        <SmallCaps size={20} gap={8} color="rgba(255, 255, 255, 0.65)">Showtime</SmallCaps>
        {time && (
          <div style={{ fontFamily: '"Cooper Black", Georgia, serif', fontSize: 66, color: 'rgba(255, 255, 255, 0.9)', lineHeight: 0.9 }}>
            {time}
          </div>
        )}
      </div>

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
          filter: invertLogo ? 'invert(1)' : undefined,
        }}
      />
      {bannerSrc && (
        <img
          data-pdf-layer="event-banner"
          src={bannerSrc}
          alt=""
          crossOrigin="anonymous"
          style={{
            position: 'absolute',
            bottom: 230,
            right: 140,
            width: 220,
            height: 220,
            objectFit: 'contain',
            filter: 'drop-shadow(0 3px 8px rgba(0,0,0,0.45))',
          }}
        />
      )}
      <div data-pdf-layer="sticker" style={{ position: 'absolute', inset: 0 }}>
        <StickerOverlay sticker={sticker} position={stickerPosition} accent={accent} />
      </div>
    </CardFrame>
  )
}

function MinimalStory({ gig, photoSrc, pan = 0, accent, socials, sticker, stickerPosition, logoSrc, bannerSrc, invertLogo }) {
  const f = SHARE_FORMATS.story
  const date = formatGigDateShort(gig)
  const venueName = formatGigVenueName(gig)
  const city = formatGigCity(gig)
  const title = gig?.event_description || ''

  return (
    <CardFrame format={f} background={PAPER} color={INK}>
      {/* Photo — top panel */}
      <div
        data-share-layer="photo"
        data-pdf-layer="photo"
        style={{ position: 'absolute', top: 0, left: 0, width: 1080, height: 1200, overflow: 'hidden' }}
      >
        <PhotoBackdrop src={photoSrc} pan={pan} width={1080} height={1200} filter="contrast(1.05) saturate(0.92)" bgColor="#22201d" />
      </div>

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

      {title && (
        <div
          data-pdf-layer="title"
          style={{
            position: 'absolute',
            top: 1400,
            left: 80,
            right: 80,
            fontFamily: '"Cooper Black", Georgia, serif',
            fontSize: calculateTitleFontSize(title, 110, 36),
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
          {city && <SmallCaps size={26} gap={6} color={SUBTLE}>{city}</SmallCaps>}
          <SocialsRow socials={socials} iconColor={accent} textColor={SUBTLE} size={26} />
        </div>
      </div>

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
          filter: invertLogo ? 'invert(1)' : undefined,
        }}
      />
      {bannerSrc && (
        <img
          data-pdf-layer="event-banner"
          src={bannerSrc}
          alt=""
          crossOrigin="anonymous"
          style={{
            position: 'absolute',
            top: 1030,
            right: 70,
            width: 220,
            height: 220,
            objectFit: 'contain',
            filter: 'drop-shadow(0 3px 10px rgba(0,0,0,0.5))',
          }}
        />
      )}
      <div data-pdf-layer="sticker" style={{ position: 'absolute', inset: 0 }}>
        <StickerOverlay sticker={sticker} position={stickerPosition} accent={accent} />
      </div>
    </CardFrame>
  )
}

export { MinimalSquare as Square, MinimalStory as Story }
