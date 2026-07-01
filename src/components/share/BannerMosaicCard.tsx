import { forwardRef, useCallback, useMemo, useState } from 'react'
import { SHARE_FORMATS } from '../../utils/shareCard.ts'

interface GigWithBanner {
  id: number
  banner_path: string
}

interface RowItem {
  gig: GigWithBanner
  aspect: number
}

interface LayoutRow {
  items: RowItem[]
  aspectSum: number
}

interface ScoredLayout {
  rows: LayoutRow[]
  baseHeights: number[]
  baseHeight: number
  scale: number
  usedArea: number
}

interface Tile {
  gig: GigWithBanner
  x: number
  y: number
  width: number
  height: number
}

function buildRowsForCount(gigs: GigWithBanner[], aspectRatios: number[], rowCount: number, frameWidth: number, frameHeight: number): LayoutRow[] {
  const rows: LayoutRow[] = []
  const targetAspectPerRow = (frameWidth * rowCount) / frameHeight
  let index = 0

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const remainingRows = rowCount - rowIndex - 1
    const row: RowItem[] = []
    let aspectSum = 0

    while (index < gigs.length && gigs.length - index > remainingRows) {
      const nextAspect = aspectRatios[index]
      if (remainingRows === 0) {
        row.push({ gig: gigs[index], aspect: nextAspect })
        aspectSum += nextAspect
        index += 1
        continue
      }

      const withoutNext = Math.abs(targetAspectPerRow - aspectSum)
      const withNext = Math.abs(targetAspectPerRow - (aspectSum + nextAspect))

      if (row.length > 0 && withNext > withoutNext) break
      row.push({ gig: gigs[index], aspect: nextAspect })
      aspectSum += nextAspect
      index += 1
    }

    rows.push({ items: row, aspectSum })
  }

  return rows
}

function scoreRows(rows: LayoutRow[], frameWidth: number, frameHeight: number): ScoredLayout {
  const baseHeights = rows.map((row) => frameWidth / row.aspectSum)
  const baseHeight = baseHeights.reduce((sum, h) => sum + h, 0)
  const scale = Math.min(1, frameHeight / baseHeight)
  const usedArea = baseHeights.reduce((sum, h, index) => (
    sum + rows[index].aspectSum * (h * scale) * (h * scale)
  ), 0)

  return { rows, baseHeights, baseHeight, scale, usedArea }
}

function buildMosaicLayout(gigs: GigWithBanner[], aspectRatios: number[], format: string): Tile[] {
  const { width, height } = SHARE_FORMATS[format]
  if (gigs.length === 0) return []

  let best: ScoredLayout | null = null

  for (let rowCount = 1; rowCount <= gigs.length; rowCount += 1) {
    const rows = buildRowsForCount(gigs, aspectRatios, rowCount, width, height)
    if (rows.some((row) => row.items.length === 0)) continue

    const scored = scoreRows(rows, width, height)
    const layout = { ...scored }

    if (!best || layout.usedArea > best.usedArea) {
      best = layout
    }
  }

  if (!best) return []

  const totalHeight = best.baseHeight * best.scale
  let top = (height - totalHeight) / 2
  const tiles: Tile[] = []

  for (let rowIndex = 0; rowIndex < best.rows.length; rowIndex += 1) {
    const row = best.rows[rowIndex]
    const rowHeight = best.baseHeights[rowIndex] * best.scale
    const rowWidth = row.aspectSum * rowHeight
    let left = (width - rowWidth) / 2

    row.items.forEach(({ gig, aspect }) => {
      const tileWidth = aspect * rowHeight
      tiles.push({
        gig,
        x: left,
        y: top,
        width: tileWidth,
        height: rowHeight,
      })
      left += tileWidth
    })

    top += rowHeight
  }

  return tiles
}

interface BannerImageProps {
  gig: GigWithBanner
  style?: React.CSSProperties
  onImageLoad?: (e: React.SyntheticEvent<HTMLImageElement>) => void
}

function BannerImage({ gig, style, onImageLoad }: Readonly<BannerImageProps>) {
  return (
    <img
      crossOrigin="anonymous"
      src={`/api/files/${gig.banner_path}`}
      alt=""
      onLoad={onImageLoad}
      style={{ display: 'block', ...style }}
    />
  )
}

interface BannerMosaicCardProps {
  gigs: GigWithBanner[]
  format: 'square' | 'story'
  backgroundColor?: string
}

const BannerMosaicCard = forwardRef<HTMLDivElement, BannerMosaicCardProps>(function BannerMosaicCard({ gigs, format, backgroundColor = '#000' }, ref) {
  const { width, height } = SHARE_FORMATS[format]
  const [aspectByPath, setAspectByPath] = useState<Record<string, number>>({})
  const aspectRatios = useMemo(() => (
    gigs.map((g) => aspectByPath[g.banner_path] || 1)
  ), [aspectByPath, gigs])
  const tiles = useMemo(() => (
    buildMosaicLayout(gigs, aspectRatios, format)
  ), [aspectRatios, format, gigs])

  const handleImageLoad = useCallback((gig: GigWithBanner, e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = e.currentTarget
    if (!naturalWidth || !naturalHeight) return

    const aspect = naturalWidth / naturalHeight
    setAspectByPath((prev) => (
      prev[gig.banner_path] === aspect
        ? prev
        : { ...prev, [gig.banner_path]: aspect }
    ))
  }, [])

  return (
    <div
      ref={ref}
      style={{
        width,
        height,
        background: backgroundColor,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {tiles.map((tile, index) => (
        <BannerImage
          key={`${tile.gig.id}-${tile.gig.banner_path}-${index}`}
          gig={tile.gig}
          onImageLoad={(e) => handleImageLoad(tile.gig, e)}
          style={{
            position: 'absolute',
            left: tile.x,
            top: tile.y,
            width: tile.width,
            height: tile.height,
          }}
        />
      ))}
    </div>
  )
})

export default BannerMosaicCard
