import { forwardRef } from 'react'
import { formatGigRowDate, SHARE_FORMATS } from '../../utils/shareCard.js'
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
        <stop offset='0%' stop-color='%23ffd97a' stop-opacity='0.45'/>
        <stop offset='55%' stop-color='%23b34a1a' stop-opacity='0'/>
      </radialGradient>
    </defs>
    <rect width='100%' height='100%' fill='url(#r)'/>
  </svg>`
)}`

function calculateRowFontSize(count, availableHeight) {
  const MAX_FONT = 52
  const minFont = Math.max(18, 52 - count * 2.5)
  const idealFont = (availableHeight / count) * 0.55
  return Math.min(MAX_FONT, Math.max(minFont, idealFont))
}

function TourFrame({ format, photoSrc, photoOpacity, accent, children }) {
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
      {photoSrc && (
        <img
          src={photoSrc}
          alt=""
          crossOrigin="anonymous"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: photoOpacity / 100,
            filter: 'contrast(1.05) saturate(0.85) sepia(0.35)',
          }}
        />
      )}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.62)' }} />
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
          inset: 36,
          border: `2px solid ${accent}`,
          outline: '2px solid rgba(0,0,0,0.5)',
          outlineOffset: 6,
          borderRadius: 28,
          pointerEvents: 'none',
        }}
      />
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

function GigRow({ gig, today, fontSize, rowHeight, accent, isLast }) {
  const gigDate = String(gig.event_date).slice(0, 10)
  const isPast = gigDate < today
  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          height: rowHeight,
          opacity: isPast ? 0.38 : 1,
          fontSize,
          lineHeight: 1,
        }}
      >
        <div
          style={{
            color: accent,
            width: '18%',
            flexShrink: 0,
            fontFamily: '"Cooper Black", sans-serif',
            fontSize: fontSize * 0.8,
            letterSpacing: 2,
            whiteSpace: 'nowrap',
          }}
        >
          {formatGigRowDate(gig)}
        </div>
        <div
          style={{
            color: PAPER,
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            padding: '0 20px',
            fontFamily: '"Rockwell", sans-serif',
            fontSize,
            textShadow: '0 1px 4px rgba(0,0,0,0.8)',
          }}
        >
          {gig.event_description || ''}
        </div>
        {gig.city && (
          <div
            style={{
              color: 'rgba(246,239,226,0.65)',
              width: '22%',
              flexShrink: 0,
              textAlign: 'right',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize,
              fontFamily: '"Onyx", sans-serif',
              letterSpacing: 2,
            }}
          >
            {gig.city}
          </div>
        )}
      </div>
      {!isLast && <div style={{ height: 1, background: 'rgba(245,197,66,0.2)' }} />}
    </div>
  )
}

function GigList({ gigs, today, fontSize, rowHeight, accent }) {
  if (gigs.length === 0) {
    return (
      <div
        style={{
          color: PAPER,
          opacity: 0.5,
          fontSize: 36,
          fontFamily: '"Cooper Black", sans-serif',
          textAlign: 'center',
          paddingTop: 40,
        }}
      >
        No gigs
      </div>
    )
  }
  return gigs.map((gig, i) => (
    <GigRow
      key={gig.id}
      gig={gig}
      today={today}
      fontSize={fontSize}
      rowHeight={rowHeight}
      accent={accent}
      isLast={i === gigs.length - 1}
    />
  ))
}

// Square layout: compact, graphic, medium logo
// List available height: 1080 - 65(top) - 90(logo) - 20(gap) - 64(title) - 16(gap) - 3(hair) - 20(gap) - 20(gap) - 3(hair) - 75(bot) ≈ 704
function TourSquare({ gigs, photoSrc, photoOpacity, accent, year, today, socials, logoSrc }) {
  const LIST_AVAILABLE = 620
  const count = gigs.length || 1
  const fontSize = calculateRowFontSize(count, LIST_AVAILABLE)
  const rowHeight = fontSize * 1.65

  return (
    <TourFrame format="square" photoSrc={photoSrc} photoOpacity={photoOpacity} accent={accent}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '65px 70px 75px',
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
            fontSize: 56,
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
        <div style={{ flex: 1 }} />
        <div style={{ width: '100%', overflow: 'hidden' }}>
          <GigList gigs={gigs} today={today} fontSize={fontSize} rowHeight={rowHeight} accent={accent} />
        </div>
        <SocialsRow socials={socials} iconColor={accent} textColor={PAPER} size={28} style={{ marginTop: 16 }} />
      </div>
    </TourFrame>
  )
}

// Story layout: airy, large logo, "ON TOUR" and year on separate lines for drama
// List available height: 1920 - 80(top) - 120(logo) - 28(gap) - 95(ON TOUR) - 60(year) - 20(gap) - 3(hair) - 24(gap) - 24(gap) - 3(hair) - 90(bot) ≈ 1373
function TourStory({ gigs, photoSrc, photoOpacity, accent, year, today, socials, logoSrc }) {
  const LIST_AVAILABLE = 1280
  const count = gigs.length || 1
  const fontSize = calculateRowFontSize(count, LIST_AVAILABLE)
  const rowHeight = fontSize * 1.65

  return (
    <TourFrame format="story" photoSrc={photoSrc} photoOpacity={photoOpacity} accent={accent}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '80px 70px 90px',
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
            fontSize: 88,
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
        <div style={{ flex: 1 }} />
        <div style={{ width: '100%', overflow: 'hidden' }}>
          <GigList gigs={gigs} today={today} fontSize={fontSize} rowHeight={rowHeight} accent={accent} />
        </div>
        <SocialsRow socials={socials} iconColor={accent} textColor={PAPER} size={28} style={{ marginTop: 20 }} />
      </div>
    </TourFrame>
  )
}

const TourShareCard = forwardRef(function TourShareCard(
  { gigs = [], photoSrc, photoOpacity = 35, accent = '#f5c542', format = 'square', socials, year: yearProp, logoSrc },
  ref,
) {
  const today = new Date().toISOString().slice(0, 10)
  const year = yearProp ?? (gigs.length > 0
    ? new Date(gigs[0].event_date).getFullYear()
    : new Date().getFullYear())

  const props = { gigs, photoSrc, photoOpacity, accent, year, today, socials, logoSrc }

  return (
    <div ref={ref}>
      {format === 'story'
        ? <TourStory {...props} />
        : <TourSquare {...props} />}
    </div>
  )
})

export default TourShareCard
