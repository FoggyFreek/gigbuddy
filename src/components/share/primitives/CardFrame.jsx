export default function CardFrame({ format, background, color, children, style }) {
  return (
    <div
      data-share-frame
      style={{
        position: 'relative',
        width: format.width,
        height: format.height,
        background,
        overflow: 'hidden',
        color,
        ...style,
      }}
    >
      {children}
    </div>
  )
}
