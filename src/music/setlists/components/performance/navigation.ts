// Stepping through a running setlist, page-then-song: a slide's own screenfuls
// (PDF pages, or a chart too long for one screen) are exhausted before the show
// moves on, and both ends wrap so a set can run on a loop.
export interface Position {
  slide: number
  page: number
}

export function stepForward(pos: Position, slideCount: number, pages: number): Position {
  if (pos.page < pages - 1) return { slide: pos.slide, page: pos.page + 1 }
  return { slide: (pos.slide + 1) % slideCount, page: 0 }
}

// Going back lands on the *last* page of the previous slide, so a pedal tapped
// one song too far retraces exactly the way it came.
export function stepBack(
  pos: Position,
  slideCount: number,
  pagesOf: (slide: number) => number,
): Position {
  if (pos.page > 0) return { slide: pos.slide, page: pos.page - 1 }
  const previous = (pos.slide - 1 + slideCount) % slideCount
  return { slide: previous, page: Math.max(0, pagesOf(previous) - 1) }
}
