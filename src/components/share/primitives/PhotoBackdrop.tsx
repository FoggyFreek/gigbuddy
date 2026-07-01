import type { CSSProperties, ReactNode } from 'react'
import { useState } from 'react'

interface NaturalSize {
  w: number
  h: number
}

interface PhotoBackdropProps {
  src?: string
  zoom?: number
  pan?: number
  width?: number
  height?: number
  filter?: string
  bgColor?: string
  children?: ReactNode
}

export default function PhotoBackdrop({
  src, zoom, pan = 0, width, height,
  filter = 'contrast(1.05)',
  bgColor = '#000',
  children,
}: Readonly<PhotoBackdropProps>) {
  const [natural, setNatural] = useState<NaturalSize | null>(null)

  let imgStyle: CSSProperties
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
