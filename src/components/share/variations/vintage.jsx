import {
  calculateTitleFontSize,
  formatGigCity,
  formatGigDateShort,
  formatGigDoorsTime,
  formatGigVenue,
  formatGigVenueName,
  SHARE_FORMATS,
} from '../../../utils/shareCard.js'
import FilmFrame from '../primitives/FilmFrame.jsx'
import PhotoBackdrop from '../primitives/PhotoBackdrop.jsx'
import SocialsRow from '../SocialsRow.jsx'
import StickerOverlay from '../StickerOverlay.jsx'

const FALLBACK_LOGO = '/share/logo.png'
const ACCENT = '#f5c542'
const PAPER = '#f6efe2'

const SUNBURST_SVG = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='xMidYMid slice'>
    <defs>
      <radialGradient id='r' cx='50%' cy='50%' r='65%'>
        <stop offset='0%' stop-color='%23ffd97a' stop-opacity='0.65'/>
        <stop offset='55%' stop-color='%23b34a1a' stop-opacity='0'/>
      </radialGradient>
    </defs>
    <rect width='100%' height='100%' fill='url(#r)'/>
  </svg>`
)}`

function VintageSquare({ gig, photoSrc, pan = 0, accent = ACCENT, socials, sticker, stickerPosition, logoSrc, bannerSrc, invertLogo }) {
  const f = SHARE_FORMATS.square
  const date = formatGigDateShort(gig)
  const time = formatGigDoorsTime(gig)
  const venueName = formatGigVenueName(gig)
  const city = formatGigCity(gig)
  const title = gig?.event_description || ''

  return (
    <FilmFrame format="square" accent={accent}>
      <div data-share-layer="photo" data-pdf-layer="photo" style={{ position: 'absolute', inset: 0 }}>
        <PhotoBackdrop src={photoSrc} pan={pan} width={f.width} height={f.height} filter="contrast(1.05) saturate(0.85) sepia(0.35)" bgColor="#1a0f06">
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: `url("${SUNBURST_SVG}")`,
              backgroundSize: 'cover',
              mixBlendMode: 'screen',
              pointerEvents: 'none',
            }}
          />
        </PhotoBackdrop>
      </div>
      <div
        data-pdf-layer="gradient"
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(0,0,0,0.85) 95%)',
        }}
      />
      <img
        data-pdf-layer="logo"
        src={logoSrc || FALLBACK_LOGO}
        alt=""
        crossOrigin="anonymous"
        style={{
          position: 'absolute',
          top: 70,
          left: 70,
          width: 250,
          height: 'auto',
          filter: `${invertLogo ? 'invert(1) ' : ''}drop-shadow(0 2px 6px rgba(0,0,0,0.6))`,
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
            top: 80,
            right: 80,
            width: 260,
            height: 260,
            objectFit: 'contain',
            filter: 'drop-shadow(0 3px 8px rgba(0,0,0,0.55))',
          }}
        />
      )}
      {title && (
        <div
          data-pdf-layer="title"
          style={{
            position: 'absolute',
            left: 70,
            right: 70,
            bottom: 510,
            fontFamily: '"Cooper Black", serif',
            fontSize: calculateTitleFontSize(title, 84, 32),
            lineHeight: 1.05,
            color: PAPER,
            textShadow: '0 3px 8px rgba(0,0,0,0.8)',
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
        data-pdf-layer="date"
        style={{
          position: 'absolute',
          left: 70,
          right: 70,
          bottom: 230,
          display: 'flex',
          alignItems: 'baseline',
          gap: 28,
        }}
      >
        <div style={{ fontFamily: 'Cooper Black, sans-serif', fontSize: 200, lineHeight: 0.85, color: accent, textShadow: '0 4px 12px rgba(0,0,0,0.7)' }}>
          {date.day}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', paddingBottom: 12, minWidth: 0, flexGrow: 1 }}>
          <div style={{ fontFamily: 'Cooper Black, sans-serif', fontSize: 72, lineHeight: 1, letterSpacing: 4, color: PAPER, textTransform: 'uppercase' }}>{date.month}</div>
          <div style={{ fontFamily: 'Cooper Black, sans-serif', fontSize: 44, lineHeight: 1.1, letterSpacing: 6, color: PAPER, textTransform: 'uppercase', opacity: 0.8 }}>{date.year}</div>
          {venueName && (
            <div style={{ fontFamily: '"Bebas Neue", sans-serif', fontSize: 40, lineHeight: 1.1, letterSpacing: 4, color: PAPER, textTransform: 'uppercase', textShadow: '0 2px 6px rgba(0,0,0,0.8)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 14 }}>
              {venueName}
            </div>
          )}
          {city && (
            <div style={{ fontFamily: '"Cooper Black", sans-serif', fontSize: 36, lineHeight: 1.1, letterSpacing: 4, color: PAPER, textTransform: 'uppercase', textShadow: '0 2px 6px rgba(0,0,0,0.8)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', opacity: 0.85 }}>
              {city}
            </div>
          )}
        </div>
      </div>
      {time && (
        <div
          data-pdf-layer="time"
          style={{
            position: 'absolute',
            right: 80,
            bottom: 140,
            fontFamily: '"Cooper Black", sans-serif',
            fontSize: 32,
            letterSpacing: 8,
            color: accent,
          }}
        >
          DOORS {time}
        </div>
      )}
      <div data-pdf-layer="socials" style={{ position: 'absolute', bottom: 46, left: 70, right: 70 }}>
        <SocialsRow socials={socials} iconColor={accent} textColor={PAPER} size={26} />
      </div>
      <div data-pdf-layer="sticker" style={{ position: 'absolute', inset: 0 }}>
        <StickerOverlay sticker={sticker} position={stickerPosition} accent={accent} />
      </div>
    </FilmFrame>
  )
}

function VintageStory({ gig, photoSrc, zoom, pan = 0, accent = ACCENT, socials, sticker, stickerPosition, logoSrc, bannerSrc, invertLogo }) {
  const f = SHARE_FORMATS.story
  const date = formatGigDateShort(gig)
  const time = formatGigDoorsTime(gig)
  const venue = formatGigVenue(gig)
  const title = gig?.event_description || ''

  return (
    <FilmFrame format="story" accent={accent}>
      <div data-share-layer="photo" data-pdf-layer="photo" style={{ position: 'absolute', inset: 0 }}>
        <PhotoBackdrop src={photoSrc} zoom={zoom} pan={pan} width={f.width} height={f.height} filter="contrast(1.05) saturate(0.85) sepia(0.35)" bgColor="#000">
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: `url("${SUNBURST_SVG}")`,
              backgroundSize: 'cover',
              mixBlendMode: 'screen',
              pointerEvents: 'none',
            }}
          />
        </PhotoBackdrop>
      </div>
      <div
        data-pdf-layer="gradient"
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(180deg, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.9) 95%)',
        }}
      />
      <img
        data-pdf-layer="logo"
        src={logoSrc || FALLBACK_LOGO}
        alt=""
        crossOrigin="anonymous"
        style={{
          position: 'absolute',
          top: 90,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 420,
          height: 'auto',
          filter: `${invertLogo ? 'invert(1) ' : ''}drop-shadow(0 3px 10px rgba(0,0,0,0.7))`,
        }}
      />
     
      {title && (
        <div
          data-pdf-layer="title"
          style={{
            position: 'absolute',
            top: 500,
            left: 80,
            right: 80,
            textAlign: 'center',
            fontFamily: 'Cooper Black, serif',
            fontSize: calculateTitleFontSize(title, 110, 32),
            lineHeight: 1.05,
            color: PAPER,
            textShadow: '0 3px 10px rgba(0,0,0,0.85)',
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
        data-pdf-layer="date-day"
        style={{
          position: 'absolute',
          top: 720,
          left: 0,
          right: 0,
          textAlign: 'center',
          fontFamily: '"Cooper Black", sans-serif',
          fontSize: 300,
          lineHeight: 0.85,
          color: accent,
          textShadow: '0 6px 20px rgba(0,0,0,0.8)',
        }}
      >
        {date.day}
      </div>
      <div
        data-pdf-layer="date-month"
        style={{
          position: 'absolute',
          top: 1000,
          left: 0,
          right: 0,
          textAlign: 'center',
          fontFamily: '"Cooper Black", sans-serif',
          fontSize: 110,
          lineHeight: 1,
          letterSpacing: 12,
          color: PAPER,
          textTransform: 'uppercase',
          textShadow: '0 3px 8px rgba(0,0,0,0.8)',
        }}
      >
        {date.month}
      </div>
      <div
        data-pdf-layer="date-year"
        style={{
          position: 'absolute',
          top: 1090,
          left: 0,
          right: 0,
          textAlign: 'center',
          fontFamily: '"Cooper Black", sans-serif',
          fontSize: 56,
          letterSpacing: 16,
          color: PAPER,
          textTransform: 'uppercase',
          opacity: 0.85,
        }}
      >
        {date.year}
      </div>
      {bannerSrc && (
        <img
          data-pdf-layer="event-banner"
          src={bannerSrc}
          alt=""
          crossOrigin="anonymous"
          style={{
            position: 'absolute',
            bottom: 430,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 280,
            height: 280,
            objectFit: 'contain',
            filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.6))',
          }}
        />
      )}
      <div
        data-pdf-layer="venue-info"
        style={{
          position: 'absolute',
          left: 80,
          right: 80,
          bottom: 160,
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          alignItems: 'center',
        }}
      >
        {venue && (
          <div
            style={{
              fontFamily: '"Cooper Black", sans-serif',
              fontSize: 36,
              letterSpacing: 6,
              color: PAPER,
              textTransform: 'uppercase',
              textShadow: '0 2px 6px rgba(0,0,0,0.85)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {venue}
          </div>
        )}
        {time && (
          <div style={{ fontFamily: '"Cooper Black", sans-serif', fontSize: 38, letterSpacing: 12, color: accent }}>
            {time}
          </div>
        )}
      </div>
      <div data-pdf-layer="socials" style={{ position: 'absolute', bottom: 56, left: 80, right: 80 }}>
        <SocialsRow socials={socials} iconColor={accent} textColor={PAPER} size={28} />
      </div>
      <div data-pdf-layer="sticker">
        <StickerOverlay sticker={sticker} position={stickerPosition} accent={accent} />
      </div>
    </FilmFrame>
  )
}

export { VintageSquare as Square, VintageStory as Story }
