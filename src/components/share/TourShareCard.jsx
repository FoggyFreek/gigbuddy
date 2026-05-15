import { forwardRef } from 'react'
import { SHARE_FORMATS } from '../../utils/shareCard.js'
import PhotoBackdrop from './primitives/PhotoBackdrop.jsx'
import SocialsRow from './SocialsRow.jsx'

const FALLBACK_LOGO = '/share/logo.png'

const PAPER = '#f6efe2'

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
        <stop offset='0%' stop-color='%23ffd97a' stop-opacity='0.25'/>
        <stop offset='55%' stop-color='%23b34a1a' stop-opacity='0'/>
      </radialGradient>
    </defs>
    <rect width='100%' height='100%' fill='url(#r)'/>
  </svg>`
)}`

function calculateRowFontSize(count, availableHeight, rowMultiplier = 2.5) {
  const MAX_FONT = 52
  const MIN_FONT = 10
  return Math.min(MAX_FONT, Math.max(MIN_FONT, availableHeight / (count * rowMultiplier)))
}

function TourFrame({ format, photoSrc, photoOpacity, zoom, pan, children }) {
  const f = SHARE_FORMATS[format]
  return (
    <div
      style={{
        position: 'relative',
        width: f.width,
        height: f.height,
        background: '#000',
        overflow: 'hidden',
        borderRadius: 36,
      }}
    >
      <div style={{ position: 'absolute', inset: 0, opacity: photoOpacity / 100 }}>
        <PhotoBackdrop
          src={photoSrc}
          zoom={zoom}
          pan={pan}
          width={f.width}
          height={f.height}
          filter="contrast(1.05) saturate(0.85) sepia(0.35)"
          bgColor="transparent"
        />
      </div>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.22)' }} />
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
      {children}
      
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
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.65) 100%)',
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}

function GigRow({ gig, today, fontSize, rowHeight, accent, showBanners }) {
  const gigDate = String(gig.event_date).slice(0, 10)
  const isPast = gigDate < today
  const d = new Date(gig.event_date)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const bannerSrc = showBanners && gig.banner_path ? `/api/files/${gig.banner_path}` : null

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          height: rowHeight,
          opacity: isPast ? 0.38 : 1,
          width: '90%',
        }}
      >
        {/* date column */}
        <div
          style={{
            width: '25%',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: accent,
            fontFamily: '"Roboto Condensed", sans-serif',
            fontSize: fontSize * 0.8,
            fontWeight: 700,
            letterSpacing: 2,
            whiteSpace: 'nowrap',
          }}
        >
          {dd}/{mm}
        </div>
        {/* optional banner column */}
        {bannerSrc && (
          <div
            style={{
              flexShrink: 0,
              width: rowHeight,
              height: rowHeight,
              marginRight: 10,
              borderRadius: 6,
              overflow: 'hidden',
            }}
          >
            <img
              src={bannerSrc}
              alt=""
              crossOrigin="anonymous"
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
          </div>
        )}
        {/* venue + city column */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              color: PAPER,
              fontFamily: '"Roboto Condensed", sans-serif',
              fontSize: fontSize,
              textShadow: '0 1px 4px rgba(0,0,0,0.8)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              width: '100%',
              textAlign: 'center',
            }}
          >
            {gig.event_description.toUpperCase() || ''}
          </div>
          {gig.city && (
            <div
              style={{
                color: 'rgba(246,239,226,0.65)',
                fontFamily: '"Roboto Condensed", sans-serif',
                fontSize: fontSize * 0.6,
                letterSpacing: 2,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                width: '100%',
                textAlign: 'center',
              }}
            >
              {gig.city}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function GigList({ gigs, today, fontSize, rowHeight, accent, showBanners }) {
  if (gigs.length === 0) {
    return (
      <div
        style={{
          color: PAPER,
          opacity: 0.5,
          fontSize: 36,
          fontFamily: '"Roboto Condensed", sans-serif',
          textAlign: 'center',
          paddingTop: 40,
        }}
      >
        No gigs
      </div>
    )
  }
  return gigs.map((gig) => (
    <GigRow
      key={gig.id}
      gig={gig}
      today={today}
      fontSize={fontSize}
      rowHeight={rowHeight}
      accent={accent}
      showBanners={showBanners}
    />
  ))
}

// Square layout: compact, graphic, medium logo
// List available height: 1080 - 65(top) - 90(logo) - 20(gap) - 64(title) - 16(gap) - 3(hair) - 20(gap) - 20(gap) - 3(hair) - 75(bot) ≈ 704
function TourSquare({ gigs, photoSrc, photoOpacity, zoom, pan, accent, year, today, socials, logoSrc, showBanners }) {
  const LIST_AVAILABLE = 620
  const count = gigs.length || 1
  const fontSize = calculateRowFontSize(count, LIST_AVAILABLE)
  const rowHeight = fontSize * 2.5

  return (
    <TourFrame format="square" photoSrc={photoSrc} photoOpacity={photoOpacity} zoom={zoom} pan={pan}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '15px 50px 15px',
        }}
      >
        <img
          src={logoSrc || FALLBACK_LOGO}
          alt=""
          crossOrigin="anonymous"
          style={{
            width: 280,
            height: 'auto',
            marginBottom: 20,
            filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.7))',
          }}
        />
        <div
          style={{
            fontFamily: '"Cooper Black", sans-serif',
            fontSize: 38,
            letterSpacing: 10,
            color: accent,
            textShadow: '0 2px 6px rgba(0,0,0,0.7)',
            marginBottom: 16,
            textAlign: 'center',
            whiteSpace: 'nowrap',
          }}
        >
          ON TOUR · {year}
        </div>
        <div style={{ flex: 1, width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', overflow: 'hidden' }}>
          <GigList gigs={gigs} today={today} fontSize={fontSize} rowHeight={rowHeight} accent={accent} showBanners={showBanners} />
        </div>
        <SocialsRow socials={socials} iconColor={accent} textColor={PAPER} size={28} style={{ marginTop: 16 }} />
      </div>
    </TourFrame>
  )
}

// Story layout: airy, large logo, "ON TOUR" and year on separate lines for drama
// List available height: 1920 - 80(top) - 120(logo) - 28(gap) - 95(ON TOUR) - 60(year) - 20(gap) - 3(hair) - 24(gap) - 24(gap) - 3(hair) - 90(bot) ≈ 1373
function TourStory({ gigs, photoSrc, photoOpacity, zoom, pan, accent, year, today, socials, logoSrc, showBanners }) {
  const LIST_AVAILABLE = 1280
  const count = gigs.length || 1
  const fontSize = calculateRowFontSize(count, LIST_AVAILABLE)
  const rowHeight = fontSize * 2.5

  return (
    <TourFrame format="story" photoSrc={photoSrc} photoOpacity={photoOpacity} zoom={zoom} pan={pan}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '20px 50px 20px',
        }}
      >
        <img
          src={logoSrc || FALLBACK_LOGO}
          alt=""
          crossOrigin="anonymous"
          style={{
            width: 620,
            height: 'auto',
            marginBottom: 28,
            filter: 'drop-shadow(0 3px 10px rgba(0,0,0,0.7))',
          }}
        />
        <div
          style={{
            fontFamily: '"Cooper Black", sans-serif',
            fontSize: 78,
            letterSpacing: 14,
            color: accent,
            textShadow: '0 3px 8px rgba(0,0,0,0.7)',
            textAlign: 'center',
            lineHeight: 1,
            whiteSpace: 'nowrap',
          }}
        >
          ON TOUR
        </div>
        <div
          style={{
            fontFamily: '"Cooper Black", sans-serif',
            fontSize: 46,
            letterSpacing: 20,
            color: PAPER,
            textShadow: '0 2px 6px rgba(0,0,0,0.7)',
            textAlign: 'center',
            marginBottom: 20,
            opacity: 0.85,
          }}
        >
          · {year} ·
        </div>
        <div style={{ flex: 1, width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', overflow: 'hidden' }}>
          <GigList gigs={gigs} today={today} fontSize={fontSize} rowHeight={rowHeight} accent={accent} showBanners={showBanners} />
        </div>
        <SocialsRow socials={socials} iconColor={accent} textColor={PAPER} size={28} style={{ marginTop: 20 }} />
      </div>
    </TourFrame>
  )
}

const TourShareCard = forwardRef(function TourShareCard(
  { gigs = [], photoSrc, photoOpacity = 35, zoom, pan = 0, accent = '#f5c542', format = 'square', socials, year: yearProp, logoSrc, showBanners = false },
  ref,
) {
  const today = new Date().toISOString().slice(0, 10)
  const year = yearProp ?? (gigs.length > 0
    ? new Date(gigs[0].event_date).getFullYear()
    : new Date().getFullYear())

  const props = { gigs, photoSrc, photoOpacity, zoom, pan, accent, year, today, socials, logoSrc, showBanners }

  return (
    <div ref={ref}>
      {format === 'story'
        ? <TourStory {...props} />
        : <TourSquare {...props} />}
    </div>
  )
})

export default TourShareCard
