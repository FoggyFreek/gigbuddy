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
import FormControlLabel from '@mui/material/FormControlLabel'
import FormGroup from '@mui/material/FormGroup'
import Grid from '@mui/material/Grid'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import LocalMallIcon from '@mui/icons-material/LocalMall'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import StatusDot from '../StatusDot.tsx'
import { getGigMerchSummary } from '../../api/gigs.ts'
import { draftFromGig, listInvoicesByGig } from '../../api/invoices.ts'
import { createInvoiceFromGigDraft } from '../invoices/createInvoiceFromGigDraft.ts'
import { usePermissions } from '../../hooks/usePermissions.ts'
import { formatShortDate } from '../../utils/dateFormat.ts'
import { formatEur } from '../../utils/invoiceTotals.ts'
import { invoiceStatusColor } from '../../utils/invoiceStatus.ts'
import type { GigMerchSummary, Id, Invoice, InvoiceStatus, Venue } from '../../types/entities.ts'
import type { GigDetailForm } from './types.ts'

const NO_NUMBER_SPINNER_SX = {
  '& input[type=number]': { MozAppearance: 'textfield' },
  '& input[type=number]::-webkit-outer-spin-button': { WebkitAppearance: 'none', margin: 0 },
  '& input[type=number]::-webkit-inner-spin-button': { WebkitAppearance: 'none', margin: 0 },
}

interface Props {
  active: boolean
  editable: boolean
  gigId: Id
  gigLoaded: boolean
  form: GigDetailForm
  selectedVenue: Venue | null
  selectedFestival: Venue | null
  onChange: (field: string, value: unknown) => void
}

export default function GigTerms({
  active,
  editable,
  gigId,
  gigLoaded,
  form,
  selectedVenue,
  selectedFestival,
  onChange,
}: Readonly<Props>) {
  const { t, i18n } = useTranslation(['gigs', 'common'])
  const { canViewFinance, canManageFinance } = usePermissions()
  const navigate = useNavigate()
  const [merchSummary, setMerchSummary] = useState<GigMerchSummary | null>(null)
  const [relatedInvoices, setRelatedInvoices] = useState<Invoice[] | null>(null)
  const [invoiceConfirmOpen, setInvoiceConfirmOpen] = useState(false)
  const [invoiceBusy, setInvoiceBusy] = useState(false)
  const [invoiceError, setInvoiceError] = useState<string | null>(null)

  useEffect(() => {
    if (!gigLoaded || !editable) {
      setMerchSummary(null)
      return
    }
    const controller = new AbortController()
    getGigMerchSummary(gigId, { signal: controller.signal })
      .then(setMerchSummary)
      .catch((error: Error) => { if (!controller.signal.aborted) console.error(error) })
    return () => controller.abort()
  }, [gigId, gigLoaded, editable])

  useEffect(() => {
    if (!gigLoaded || !canViewFinance) {
      setRelatedInvoices([])
      return
    }
    const controller = new AbortController()
    listInvoicesByGig(gigId, { signal: controller.signal })
      .then(setRelatedInvoices)
      .catch((error: Error) => { if (!controller.signal.aborted) console.error(error) })
    return () => controller.abort()
  }, [gigId, gigLoaded, canViewFinance])

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
          <Grid size={12}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
              {t($ => $.detail.terms)}
            </Typography>
          </Grid>
          <Grid size={12}>
            <FormControlLabel
              control={
                <Switch
                  checked={form.admission === 'paid'}
                  disabled={!editable}
                  onChange={(event) => onChange('admission', event.target.checked ? 'paid' : 'free')}
                />
              }
              label={t($ => $.detail.paidAdmission)}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label={t($ => $.detail.guaranteedFee)}
              fullWidth
              value={form.booking_fee}
              onChange={(event) => onChange('booking_fee', event.target.value)}
              placeholder="0.00"
              slotProps={{
                htmlInput: { readOnly: !editable },
                input: { startAdornment: <InputAdornment position="start">€</InputAdornment> },
              }}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label={t($ => $.detail.merchandiseCut)}
              type="number"
              fullWidth
              value={form.merchandise_cut}
              onChange={(event) => onChange('merchandise_cut', event.target.value)}
              placeholder="0"
              sx={NO_NUMBER_SPINNER_SX}
              slotProps={{
                htmlInput: { min: 0, max: 100, step: 0.5, readOnly: !editable },
                input: { endAdornment: <InputAdornment position="end">%</InputAdornment> },
              }}
            />
          </Grid>
          {form.admission === 'paid' && (
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label={t($ => $.detail.percentageOfNetSales)}
                type="number"
                fullWidth
                value={form.percentage_of_sales}
                onChange={(event) => onChange('percentage_of_sales', event.target.value)}
                placeholder="0"
                sx={NO_NUMBER_SPINNER_SX}
                slotProps={{
                  htmlInput: { min: 0, max: 100, step: 0.5, readOnly: !editable },
                  input: { endAdornment: <InputAdornment position="end">%</InputAdornment> },
                }}
              />
            </Grid>
          )}
          {form.admission === 'paid' && (
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
          )}

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

          {canViewFinance && ((relatedInvoices && relatedInvoices.length > 0) || canCreateInvoice) && (
            <Grid size={12}>
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

          <Grid size={12}>
            <Divider sx={{ my: 1 }} />
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
              {t($ => $.detail.equipmentOnSite)}
            </Typography>
            <FormGroup row>
              <FormControlLabel
                control={
                  <Switch
                    checked={form.has_pa_system}
                    disabled={!editable}
                    onChange={(event) => onChange('has_pa_system', event.target.checked)}
                  />
                }
                label={t($ => $.detail.paSystem)}
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={form.has_drumkit}
                    disabled={!editable}
                    onChange={(event) => onChange('has_drumkit', event.target.checked)}
                  />
                }
                label={t($ => $.detail.drumkit)}
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={form.has_stage_lights}
                    disabled={!editable}
                    onChange={(event) => onChange('has_stage_lights', event.target.checked)}
                  />
                }
                label={t($ => $.detail.stageLight)}
              />
            </FormGroup>
          </Grid>
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
