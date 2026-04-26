import { STICKER_CONFIGS } from './stickerConfigs.js'

const POSITION_STYLES = {
  'left-top':     { top: 110,    left: 110 },
  'right-top':    { top: 110,    right: 110 },
  'left-bottom':  { bottom: 330, left: 110 },
  'right-bottom': { bottom: 330, right: 110 },
}

const POSITION_ROTATION = {
  'left-top':     -15,
  'right-top':    15,
  'left-bottom':  15,
  'right-bottom': -15,
}

export default function StickerOverlay({ sticker, position = 'right-top', accent = '#f5c542' }) {
  if (!sticker) return null
  const config = STICKER_CONFIGS[sticker]
  if (!config) return null
  const pos = POSITION_STYLES[position] ?? POSITION_STYLES['right-top']
  const rotation = POSITION_ROTATION[position] ?? 10

  return (
    <div
      style={{
        position: 'absolute',
        ...pos,
        padding: '18px 28px',
        border: `12px solid ${accent}`,
        background: 'rgba(0, 0, 0, 0.6)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 0,
        transform: `rotate(${rotation}deg)`,
        pointerEvents: 'none',
        zIndex: 10,
      }}
    >
      {config.lines.map((line, i) => (
        <div
          key={i}
          style={{
            fontFamily: '"Elephant", Georgia, serif',
            fontSize: config.sizes[i],
            lineHeight: 1.05,
            color: accent,
            textAlign: 'center',
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
            textShadow: '0 1px 6px rgba(0,0,0,0.85), 0 2px 12px rgba(0,0,0,0.55)',
          }}
        >
          {line}
        </div>
      ))}
    </div>
  )
}
