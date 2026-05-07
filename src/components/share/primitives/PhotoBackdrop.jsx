import { useState } from 'react'

export default function PhotoBackdrop({
  src, zoom, pan = 0, width, height,
  filter = 'contrast(1.05)',
  bgColor = '#000',
  children,
}) {
  const [natural, setNatural] = useState(null)

  let imgStyle
  if (natural && width && height) {
    const scaleWidth = width / natural.w
    const scaleHeight = height / natural.h
    const scale = zoom != null
      ? scaleWidth + (scaleHeight - scaleWidth) * (zoom / 100)
      : Math.max(scaleWidth, scaleHeight)
    const scaledW = natural.w * scale
    const overflow = Math.max(0, scaledW - width)
    const translateX = (pan / 100) * (overflow / 2)
    imgStyle = {
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: scaledW,
      height: natural.h * scale,
      transform: `translate(calc(-50% + ${translateX}px), -50%)`,
      filter,
    }
  } else {
    imgStyle = {
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      filter,
    }
  }

  return (
    <>
      <div style={{ position: 'absolute', inset: 0, background: bgColor }} />
      {src && (
        <img
          src={src}
          alt=""
          crossOrigin="anonymous"
          onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          style={imgStyle}
        />
      )}
      {children}
    </>
  )
}
