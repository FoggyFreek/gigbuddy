import { useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import Grid from '@mui/material/Grid'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import LocalMallIcon from '@mui/icons-material/LocalMall'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink, useNavigate } from 'react-router'
import StatusDot from '../../../../components/StatusDot.tsx'
import ArtistStatement from './terms/ArtistStatement.tsx'
import BookerSection from './terms/BookerSection.tsx'
import DealSection from './terms/DealSection.tsx'
import GigCostsEditor from './terms/GigCostsEditor.tsx'
import TaxesSection from './terms/TaxesSection.tsx'
import TicketUpside from './terms/TicketUpside.tsx'
import { dealTermsFromForm } from './gigFormFields.ts'
import { getGigMerchSummary } from '../../gigs.ts'
import { draftFromGig, listInvoicesByGig } from '../../../../finance/invoices/invoices.ts'
import { createInvoiceFromGigDraft } from '../../../../finance/invoices/components/createInvoiceFromGigDraft.ts'
import { usePermissions } from '../../../../hooks/usePermissions.ts'
import { formatShortDate } from '../../../../utils/dateFormat.ts'
import { formatEur } from '../../../../finance/invoices/invoiceTotals.ts'
import { invoiceStatusColor } from '../../../../finance/invoices/invoiceStatus.ts'
import type {
  CostPaidBy, GigCost, GigMerchSummary, Id, Invoice, InvoiceStatus, Venue,
} from '../../../../types/entities.ts'
import type { GigDetailForm } from './types.ts'

interface Props {
  active: boolean
  editable: boolean
  gigId: Id
  gigLoaded: boolean
  form: GigDetailForm
  costs: GigCost[]
  selectedVenue: Venue | null
  selectedFestival: Venue | null
  onChange: (field: string, value: unknown) => void
  onAddCost: (label: string, amountCents: number, paidBy: CostPaidBy) => Promise<void>
  onUpdateCost: (costId: Id, label: string, amountCents: number, paidBy: CostPaidBy) => Promise<void>
  onDeleteCost: (costId: Id) => Promise<void>
}

export default function GigTerms({
  active,
  editable,
  gigId,
  gigLoaded,
  form,
  costs,
  selectedVenue,
  selectedFestival,
  onChange,
  onAddCost,
  onUpdateCost,
  onDeleteCost,
}: Readonly<Props>) {
  const { t, i18n } = useTranslation(['gigs', 'common'])
  const { canViewFinance, canManageFinance } = usePermissions()
  const navigate = useNavigate()
  const [fetchedMerchSummary, setFetchedMerchSummary] = useState<GigMerchSummary | null>(null)
  const [fetchedInvoices, setFetchedInvoices] = useState<Invoice[] | null>(null)
  const [invoiceConfirmOpen, setInvoiceConfirmOpen] = useState(false)
  const [invoiceBusy, setInvoiceBusy] = useState(false)
  const [invoiceError, setInvoiceError] = useState<string | null>(null)

  // Both reads are gated. The gated-off value is derived during render rather
  // than written back by the effect, so closing the gate needs no extra render.
  const merchEnabled = gigLoaded && editable && canViewFinance
  const merchSummary = merchEnabled ? fetchedMerchSummary : null
  const invoicesEnabled = gigLoaded && canViewFinance
  const relatedInvoices = invoicesEnabled ? fetchedInvoices : []

  useEffect(() => {
    if (!merchEnabled) return
    const controller = new AbortController()
    getGigMerchSummary(gigId, { signal: controller.signal })
      .then(setFetchedMerchSummary)
      .catch((error: Error) => { if (!controller.signal.aborted) console.error(error) })
    return () => controller.abort()
  }, [gigId, merchEnabled])

  useEffect(() => {
    if (!invoicesEnabled) return
    const controller = new AbortController()
    listInvoicesByGig(gigId, { signal: controller.signal })
      .then(setFetchedInvoices)
      .catch((error: Error) => { if (!controller.signal.aborted) console.error(error) })
    return () => controller.abort()
  }, [gigId, invoicesEnabled])

  // Derived from the form rather than the saved row, so the statement and the
  // simulation track what is being typed instead of lagging the debounced save.
  const dealTerms = dealTermsFromForm(form, costs)

  const invoiceTarget = selectedFestival ?? selectedVenue
  const invoiceCustomerName = invoiceTarget?.organization_name || invoiceTarget?.name || ''
  const canCreateInvoice =
    canManageFinance &&
    relatedInvoices?.length === 0 &&
    Boolean(selectedFestival?.organization_name || selectedVenue?.organization_name)

  async function handleCreateInvoice() {
    try {
      setInvoiceBusy(true)
      setInvoiceError(null)
      const payload = await draftFromGig(gigId)
      const created = await createInvoiceFromGigDraft(payload)
      navigate(`/invoices/${created.id}`)
    } catch (error) {
      setInvoiceError((error as Error).message)
    } finally {
      setInvoiceBusy(false)
    }
  }

  return (
    <>
      <Box sx={{ display: active ? 'block' : 'none' }}>
        <Grid container spacing={2}>
          {canViewFinance && (
            <>
              <DealSection editable={editable} form={form} onChange={onChange} />
              {/* Always offered: the deal type says whether tickets are sold,
                  so there is no separate paid-admission flag to gate this on. */}
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label={t($ => $.detail.ticketLink)}
                  type="url"
                  fullWidth
                  value={form.ticket_link}
                  onChange={(event) => onChange('ticket_link', event.target.value)}
                  slotProps={{
                    htmlInput: { readOnly: !editable },
                    input: {
                      endAdornment: form.ticket_link ? (
                        <InputAdornment position="end">
                          <Tooltip title={t($ => $.detail.openLink)}>
                            <IconButton
                              size="small"
                              edge="end"
                              component="a"
                              href={form.ticket_link}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <OpenInNewIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </InputAdornment>
                      ) : null,
                    },
                  }}
                />
              </Grid>

              <GigCostsEditor
                editable={editable}
                costs={costs}
                onAdd={onAddCost}
                onUpdate={onUpdateCost}
                onDelete={onDeleteCost}
              />

              <BookerSection editable={editable} form={form} onChange={onChange} />

              <TaxesSection editable={editable} form={form} onChange={onChange} />

              <ArtistStatement terms={dealTerms} costLineCount={costs.length} />

              <TicketUpside terms={dealTerms} />

              {editable && merchSummary && merchSummary.unitsSold > 0 && (
                <Grid size={12}>
                  <Card variant="outlined" sx={{ p: 2 }}>
                    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                      <LocalMallIcon color="action" />
                      <Typography variant="subtitle2" sx={{ fontWeight: 600, flexGrow: 1 }}>
                        {t($ => $.detail.merchandiseSold)}
                      </Typography>
                      <Box sx={{ textAlign: 'right' }}>
                        <Typography variant="h6" sx={{ lineHeight: 1.2 }}>
                          {formatEur(merchSummary.netCents)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {t($ => $.detail.itemsSold, { count: merchSummary.unitsSold })}
                        </Typography>
                      </Box>
                    </Stack>
                  </Card>
                </Grid>
              )}
            </>
          )}

          {canViewFinance && ((relatedInvoices && relatedInvoices.length > 0) || canCreateInvoice) && (
            <Grid size={12}>
              <Divider sx={{ my: 1 }} />
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                {t($ => $.detail.relatedInvoices)}
              </Typography>
              {relatedInvoices && relatedInvoices.length > 0 && (
                <Card variant="outlined" sx={{ p: 2 }}>
                  <Stack divider={<Divider flexItem />} spacing={0.5}>
                    {relatedInvoices.map((invoice) => (
                      <Stack
                        key={String(invoice.id)}
                        direction="row"
                        spacing={1.5}
                        sx={{ alignItems: 'center', py: 0.5 }}
                      >
                        <StatusDot
                          color={invoiceStatusColor(invoice.status)}
                          label={invoice.status ? t($ => $.detail.invoiceStatus[invoice.status as InvoiceStatus]) : undefined}
                        />
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            #{invoice.invoice_number}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {formatShortDate(invoice.issue_date, i18n.resolvedLanguage)}
                          </Typography>
                        </Box>
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                          {formatEur(invoice.total_cents)}
                        </Typography>
                        <Tooltip title={t($ => $.detail.openInvoice)}>
                          <IconButton
                            size="small"
                            edge="end"
                            component={RouterLink}
                            to={`/invoices/${invoice.id}`}
                          >
                            <OpenInNewIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    ))}
                  </Stack>
                </Card>
              )}
              {canCreateInvoice && (
                <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                  <Button
                    variant="outlined"
                    startIcon={<ReceiptLongIcon />}
                    onClick={() => { setInvoiceError(null); setInvoiceConfirmOpen(true) }}
                  >
                    {t($ => $.detail.createInvoice)}
                  </Button>
                </Box>
              )}
            </Grid>
          )}

        </Grid>
      </Box>

      <Dialog
        open={invoiceConfirmOpen}
        onClose={() => { if (!invoiceBusy) setInvoiceConfirmOpen(false) }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>{t($ => $.detail.createInvoiceTitle)}</DialogTitle>
        <DialogContent>
          {invoiceError && <Alert severity="error" sx={{ mb: 2 }}>{invoiceError}</Alert>}
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t($ => $.detail.createInvoiceBody, { name: invoiceCustomerName })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInvoiceConfirmOpen(false)} disabled={invoiceBusy}>
            {t($ => $.common.actions.cancel)}
          </Button>
          <Button variant="contained" onClick={handleCreateInvoice} disabled={invoiceBusy}>
            {t($ => $.detail.createInvoice)}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
