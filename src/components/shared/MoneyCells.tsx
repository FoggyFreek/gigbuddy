import type { ReactNode } from 'react'
import TableCell from '@mui/material/TableCell'
import { formatEurParts } from '../../utils/invoiceTotals.ts'

interface MoneyCellsProps {
  cents?: number | string
  bold?: boolean
}

// Renders a EUR amount as two table cells: a narrow right-aligned cell holding
// just the currency symbol, then the digits. Because the symbol sits in its own
// column, the symbols line up vertically across every row while the digits stay
// right-aligned. The digit cell shrink-wraps its content (`width: '1%'` +
// nowrap) so the symbol stays next to the value: any slack from a wide column
// (e.g. a long header) is absorbed by the symbol cell, landing to the symbol's
// left rather than as a gap between the symbol and the digits. Use one
// <MoneyCells> per money column and pair it with <MoneyHeaderCells> so column
// counts match.
export default function MoneyCells({ cents, bold = false }: MoneyCellsProps) {
  const { symbol, value } = formatEurParts(cents)
  return (
    <>
      <TableCell align="right" padding="none" sx={{ pl: 2, color: 'text.secondary' }}>
        {symbol}
      </TableCell>
      <TableCell
        align="right"
        sx={{ pl: 0.5, width: '1%', whiteSpace: 'nowrap', fontWeight: bold ? 700 : undefined }}
      >
        {value}
      </TableCell>
    </>
  )
}

interface MoneyHeaderCellsProps {
  label: ReactNode
}

// Header counterpart for a MoneyCells column. A single cell spanning both the
// symbol and digit columns: the label stays right-aligned over the amount, and
// because it spans both columns its width can't inflate the (pinned) digit
// column and push the symbol away from the digits.
export function MoneyHeaderCells({ label }: MoneyHeaderCellsProps) {
  return <TableCell align="right" colSpan={2}>{label}</TableCell>
}
