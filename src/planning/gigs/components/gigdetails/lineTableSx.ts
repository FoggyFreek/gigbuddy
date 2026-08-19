// The look the gig detail's line tables share — the timetable and the cost
// lines. One outlined block with hairline-separated rows: the lines read as a
// table, not as a stack of individual form controls. The header and every row
// run on the same column track, so the hairlines line up.

export const lineTableSx = {
  border: 1,
  borderColor: 'divider',
  borderRadius: 1,
  overflow: 'hidden',
} as const

export const lineCellSx = {
  display: 'flex',
  alignItems: 'center',
  minWidth: 0,
  borderRight: 1,
  borderColor: 'divider',
  '&:last-of-type': { borderRight: 0 },
} as const

export const lineHeadCellSx = { ...lineCellSx, px: 1, py: 0.5 } as const

// The fields fill their cell edge to edge: no outline, no underline, no
// floating label — the grid's own hairlines are the only frame. With the label
// gone the name has to be set explicitly, and for a picker field that means the
// `input` slot: an aria-label on the field itself lands on the wrapper, not on
// the editable sections.
export const lineFieldSx = {
  px: 1,
  '& .MuiInputBase-root': { py: 0.75 },
  '& input': { p: 0 },
} as const
