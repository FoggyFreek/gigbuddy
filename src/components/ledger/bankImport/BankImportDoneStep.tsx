import Alert from '@mui/material/Alert'
import Paper from '@mui/material/Paper'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import { useTranslation } from 'react-i18next'
import type { BankImportResult } from '../../../types/entities.ts'
import { useStatusLabel } from './statusLabel.ts'

export function BankImportDoneStep({ result }: Readonly<{ result: BankImportResult }>) {
  const { t } = useTranslation('ledger')
  const statusLabel = useStatusLabel()
  const notes = result.results.filter((item) => ![
    'imported',
    'reconciled_invoice',
    'reconciled_purchase',
    'reconciled_shopify_payout',
    'reconciled_paypal_payout',
  ].includes(item.status))

  return (
    <>
      <Alert severity="success" sx={{ mb: 2 }}>
        {t($ => $.bankImport.done.summary, { count: result.imported, skipped: result.skipped })}
      </Alert>
      {notes.length > 0 && (
        <Paper variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ '& th': { fontWeight: 600 } }}>
                <TableCell>{t($ => $.bankImport.done.line)}</TableCell>
                <TableCell>{t($ => $.bankImport.done.status)}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {notes.map((item) => (
                <TableRow key={String(item.line_id)}>
                  <TableCell>{String(item.line_id)}</TableCell>
                  <TableCell>{statusLabel(item.status)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
    </>
  )
}
