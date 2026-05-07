import { SHARE_FORMATS } from '../../../utils/shareCard.js'

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

const CARD_RADIUS = 36
const FRAME_INSET = 36
const FRAME_RADIUS = CARD_RADIUS - 8

export default function FilmFrame({ children, format }) {
  const f = SHARE_FORMATS[format]
  return (
    <div
      data-share-frame
      style={{
        position: 'relative',
        width: f.width,
        height: f.height,
        background: '#000',
        overflow: 'hidden',
        borderRadius: CARD_RADIUS,
        fontFamily: '"Bebas Neue", system-ui, sans-serif',
        color: PAPER,
      }}
    >
      {children}
      <div data-pdf-layer="frame-decor" style={{ position: 'absolute', inset: 0 }}>
       
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
            background: 'radial-gradient(ellipse at center, transparent 65%, rgba(0,0,0,0.65) 100%)',
            pointerEvents: 'none',
          }}
        />
      </div>
    </div>
  )
}
