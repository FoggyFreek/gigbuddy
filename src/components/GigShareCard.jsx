import { forwardRef, useState } from 'react'
import {
  calculateTitleFontSize,
  formatGigCity,
  formatGigDateShort,
  formatGigDoorsTime,
  formatGigVenue,
  formatGigVenueName,
  SHARE_FORMATS,
} from '../utils/shareCard.js'

const FALLBACK_LOGO = '/share/logo.png'
import MinimalCard from './share/MinimalCard.jsx'
import PhotoCard from './share/PhotoCard.jsx'
import SocialsRow from './share/SocialsRow.jsx'
import StickerOverlay from './share/StickerOverlay.jsx'

const ACCENT = '#f5c542'
const PAPER = '#f6efe2'
const INK = '#1a1208'

const GRAIN_SVG = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'>
    <filter id='n'>
      <feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/>
      <feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.55 0'/>
    </filter>
    <rect width='100%' height='100%' filter='url(#n)' opacity='0.5'/>
  </svg>`
)}`

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


function FilmFrame({ children, format, accent = ACCENT }) {
  const f = SHARE_FORMATS[format]
  const inset = 36
  const cardRadius = 36
  const frameRadius = cardRadius - 8
  return (
    <div
      data-share-frame
      style={{
        position: 'relative',
        width: f.width,
        height: f.height,
        background: '#000',
        overflow: 'hidden',
        borderRadius: cardRadius,
        fontFamily: '"Bebas Neue", system-ui, sans-serif',
        color: PAPER,
      }}
    >
      {children}
      <div data-pdf-layer="frame-decor" style={{ position: 'absolute', inset: 0 }}>
        {/* outer frame */}
        <div
          style={{
            position: 'absolute',
            inset,
            border: `2px solid ${accent}`,
            outline: `2px solid ${INK}`,
            outlineOffset: 6,
            borderRadius: frameRadius,
            pointerEvents: 'none',
            mixBlendMode: 'normal',
          }}
        />
        {/* film grain */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: `url("${GRAIN_SVG}")`,
            backgroundSize: '400px 400px',
            opacity: 0.35,
            mixBlendMode: 'overlay',
            pointerEvents: 'none',
          }}
        />
        {/* vignette */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(ellipse at center, transparent 65%, rgba(0,0,0,0.65) 100%)',
            pointerEvents: 'none',
          }}
        />
      </div>
    </div>
  )
}

function PhotoBackdrop({ src, zoom, pan = 0, format }) {
  const [natural, setNatural] = useState(null)
  const f = SHARE_FORMATS[format] || SHARE_FORMATS.square

  let imgStyle
  if (natural) {
    const scaleWidth = f.width / natural.w
    const scaleHeight = f.height / natural.h
    // zoom: 0 = width-fit, 100 = height-fit; undefined (square) = cover
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
      filter: 'contrast(1.05) saturate(0.85) sepia(0.35)',
    }
  } else {
    imgStyle = {
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      filter: 'contrast(1.05) saturate(0.85) sepia(0.35)',
    }
  }

  const bg = zoom != null ? '#000' : '#1a0f06'

  return (
    <>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: bg,
        }}
      />
      {src && (
        <img
          src={src}
          alt=""
          crossOrigin="anonymous"
          onLoad={(e) =>
            setNatural({
              w: e.currentTarget.naturalWidth,
              h: e.currentTarget.naturalHeight,
            })
          }
          style={imgStyle}
        />
      )}
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
    </>
  )
}

function SquareLayout({ gig, photoSrc, pan = 0, accent = ACCENT, socials, sticker, stickerPosition, logoSrc, bannerSrc, invertLogo }) {
  const date = formatGigDateShort(gig)
  const time = formatGigDoorsTime(gig)
  const venueName = formatGigVenueName(gig)
  const city = formatGigCity(gig)
  const title = gig?.event_description || ''

  return (
    <FilmFrame format="square" accent={accent}>
      <div data-share-layer="photo" data-pdf-layer="photo" style={{ position: 'absolute', inset: 0 }}><PhotoBackdrop src={photoSrc} pan={pan} format="square" /></div>
      {/* dark bottom gradient for legibility */}
      <div
        data-pdf-layer="gradient"
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(0,0,0,0.85) 95%)',
        }}
      />
      {/* logo top-left */}
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
      {/* "PRESENTS" tag top-right */}
      <div
        data-pdf-layer="live"
        style={{
          position: 'absolute',
          top: 90,
          right: 80,
          fontFamily: '"Cooper Black", sans-serif',
          fontSize: 52,
          letterSpacing: 8,
          color: accent,
          textShadow: '0 2px 4px rgba(0,0,0,0.7)',
        }}
      >
        LIVE
      </div>

      {/* event banner — top-right, below LIVE tag */}
      {bannerSrc && (
        <img
          data-pdf-layer="event-banner"
          src={bannerSrc}
          alt=""
          crossOrigin="anonymous"
          style={{
            position: 'absolute',
            top: 630,
            right: 80,
            width: 160,
            height: 160,
            objectFit: 'contain',
            filter: 'drop-shadow(0 3px 8px rgba(0,0,0,0.55))',
          }}
        />
      )}

      {/* title */}
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

      {/* date block */}
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
        <div
          style={{
            fontFamily: 'Cooper Black, sans-serif',
            fontSize: 200,
            lineHeight: 0.85,
            color: accent,
            textShadow: '0 4px 12px rgba(0,0,0,0.7)',
          }}
        >
          {date.day}
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            paddingBottom: 12,
            minWidth: 0,
            flexGrow: 1,
          }}
        >
          <div
            style={{
              fontFamily: 'Cooper Black, sans-serif',
              fontSize: 72,
              lineHeight: 1,
              letterSpacing: 4,
              color: PAPER,
              textTransform: 'uppercase',
            }}
          >
            {date.month}
          </div>
          <div
            style={{
              fontFamily: 'Cooper Black, sans-serif',
              fontSize: 44,
              lineHeight: 1.1,
              letterSpacing: 6,
              color: PAPER,
              textTransform: 'uppercase',
              opacity: 0.8,
            }}
          >
            {date.year}
          </div>
          {venueName && (
            <div
              style={{
                fontFamily: '"Bebas Neue", sans-serif',
                fontSize: 40,
                lineHeight: 1.1,
                letterSpacing: 4,
                color: PAPER,
                textTransform: 'uppercase',
                textShadow: '0 2px 6px rgba(0,0,0,0.8)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                marginTop: 14,
              }}
            >
              {venueName}
            </div>
          )}
          {city && (
            <div
              style={{
                fontFamily: '"Cooper Black", sans-serif',
                fontSize: 36,
                lineHeight: 1.1,
                letterSpacing: 4,
                color: PAPER,
                textTransform: 'uppercase',
                textShadow: '0 2px 6px rgba(0,0,0,0.8)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                opacity: 0.85,
              }}
            >
              {city}
            </div>
          )}
        </div>
      </div>

      {/* divider */}
      <div
        data-pdf-layer="divider"
        style={{
          position: 'absolute',
          left: 70,
          right: 70,
          bottom: 200,
          height: 3,
          background: accent,
        }}
      />

      {/* time */}
      {time && (
        <div
          data-pdf-layer="time"
          style={{
            position: 'absolute',
            left: 530,
            right: 0,
            bottom: 110,
            fontFamily: '"Cooper Black", sans-serif',
            fontSize: 38,
            letterSpacing: 8,
            color: accent,
          }}
        >
          SHOWTIME · {time}
        </div>
      )}
      <div data-pdf-layer="socials" style={{ position: 'absolute', bottom: 46, left: 70, right: 70 }}>
        <SocialsRow socials={socials} iconColor={accent} textColor={PAPER} size={26} />
      </div>
      <div data-pdf-layer="sticker" style={{ position: 'absolute', inset: 0 }}><StickerOverlay sticker={sticker} position={stickerPosition} accent={accent} /></div>
    </FilmFrame>
  )
}

function StoryLayout({ gig, photoSrc, zoom, pan = 0, accent = ACCENT, socials, sticker, stickerPosition, logoSrc, bannerSrc, invertLogo }) {
  const date = formatGigDateShort(gig)
  const time = formatGigDoorsTime(gig)
  const venue = formatGigVenue(gig)
  const title = gig?.event_description || ''

  return (
    <FilmFrame format="story" accent={accent}>
      <div data-share-layer="photo" data-pdf-layer="photo" style={{ position: 'absolute', inset: 0 }}><PhotoBackdrop src={photoSrc} zoom={zoom} pan={pan} format="story" /></div>
      <div
        data-pdf-layer="gradient"
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.9) 95%)',
        }}
      />

      {/* logo top-center */}
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

      <div
        data-pdf-layer="live"
        style={{
          position: 'absolute',
          top: 280,
          left: 0,
          right: 0,
          textAlign: 'center',
          fontFamily: '"Cooper Black", sans-serif',
          fontSize: 56,
          letterSpacing: 16,
          color: accent,
          textShadow: '0 2px 6px rgba(0,0,0,0.7)',
        }}
      >
        LIVE
      </div>

      {/* title */}
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

      {/* huge day */}
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

      {/* event banner — centered between date and venue sections */}
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

      {/* venue + time with divider */}
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
        {/* divider */}
        <div
          style={{
            width: 800,
            height: 4,
            background: accent,
            marginBottom: 22,
          }}
        />
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
          <div
            style={{
              fontFamily: '"Cooper Black", sans-serif',
              fontSize: 38,
              letterSpacing: 12,
              color: accent,
            }}
          >
            showtime · {time}
          </div>
        )}
      </div>
      <div data-pdf-layer="socials" style={{ position: 'absolute', bottom: 56, left: 80, right: 80 }}>
        <SocialsRow socials={socials} iconColor={accent} textColor={PAPER} size={28} />
      </div>
      <div data-pdf-layer="sticker"><StickerOverlay sticker={sticker} position={stickerPosition} accent={accent} /></div>
    </FilmFrame>
  )
}

function VintageVariation({ gig, photoSrc, format, zoom, pan, accent, socials, sticker, stickerPosition, logoSrc, bannerSrc, invertLogo }) {
  return format === 'story'
    ? <StoryLayout gig={gig} photoSrc={photoSrc} zoom={zoom} pan={pan} accent={accent} socials={socials} sticker={sticker} stickerPosition={stickerPosition} logoSrc={logoSrc} bannerSrc={bannerSrc} invertLogo={invertLogo} />
    : <SquareLayout gig={gig} photoSrc={photoSrc} pan={pan} accent={accent} socials={socials} sticker={sticker} stickerPosition={stickerPosition} logoSrc={logoSrc} bannerSrc={bannerSrc} invertLogo={invertLogo} />
}

const VARIATION_COMPONENTS = {
  vintage: VintageVariation,
  minimal: MinimalCard,
  photo: PhotoCard,
}

const GigShareCard = forwardRef(function GigShareCard(
  { gig, photoSrc, format = 'square', zoom, pan, accent, variation = 'vintage', socials, sticker, stickerPosition, logoSrc, bannerSrc, bandName, showLogo, invertLogo },
  ref,
) {
  const Component = VARIATION_COMPONENTS[variation] || VintageVariation
  return (
    <div ref={ref}>
      <Component
        gig={gig}
        photoSrc={photoSrc}
        format={format}
        zoom={zoom}
        pan={pan}
        accent={accent}
        socials={socials}
        sticker={sticker}
        stickerPosition={stickerPosition}
        logoSrc={logoSrc}
        bannerSrc={bannerSrc}
        bandName={bandName}
        showLogo={showLogo}
        invertLogo={invertLogo}
      />
    </div>
  )
})

export default GigShareCard
