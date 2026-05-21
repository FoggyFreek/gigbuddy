import { useEffect, useMemo, useRef, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import FormControl from '@mui/material/FormControl'
import FormControlLabel from '@mui/material/FormControlLabel'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Switch from '@mui/material/Switch'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import DeleteIcon from '@mui/icons-material/Delete'
import DownloadIcon from '@mui/icons-material/Download'
import ImageIcon from '@mui/icons-material/Image'
import {
  createInvoice,
  deleteInvoice,
  getInvoice,
  removeInvoiceLogo,
  updateInvoice,
  uploadInvoiceLogo,
} from '../api/invoices.js'
import { computeInvoiceTotals, formatEur } from '../utils/invoiceTotals.js'
import { invoiceStatusColor } from '../utils/invoiceStatus.js'

const PAYMENT_TERMS = [
  { value: 7, label: '7 days' },
  { value: 14, label: '14 days' },
  { value: 30, label: '30 days' },
  { value: 60, label: '60 days' },
]

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'paid', label: 'Paid' },
  { value: 'void', label: 'Void' },
]

function emptyDraft(taxPct = 9) {
  return {
    gig_id: null,
    issue_date: new Date().toISOString().slice(0, 10),
    due_date: null,
    payment_term_days: 14,
    customer_name: '',
    customer_contact_title: '',
    customer_contact_given_name: '',
    customer_contact_family_name: '',
    customer_address_street: '',
    customer_address_postal_code: '',
    customer_address_city: '',
    customer_address_country: 'NL',
    customer_email: '',
    customer_kvk: '',
    customer_tax_id: '',
    memo: null,
    tax_inclusive: false,
    invert_logo: false,
    discount_type: 'pct',
    discount_pct: 0,
    discount_cents: 0,
    lines: [
      { description: '', quantity: 1, unit_price_cents: 0, tax_percentage: taxPct, position: 0 },
    ],
  }
}

function parseEuroInput(value) {
  if (value === '' || value == null) return 0
  const cleaned = String(value).replace(/[^\d,.-]/g, '').replace(',', '.')
  const num = Number(cleaned)
  if (!Number.isFinite(num)) return 0
  return Math.round(num * 100)
}

function centsToEditableEuro(cents) {
  return ((Number(cents) || 0) / 100).toFixed(2)
}

function addDays(isoDate, days) {
  if (!isoDate) return null
  const d = new Date(isoDate)
  if (Number.isNaN(d.getTime())) return null
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export default function InvoiceDetails({ mode, draft, invoiceId, onClose, embedded = false }) {
  const isEdit = mode === 'edit'
  const [loading, setLoading] = useState(isEdit)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [form, setForm] = useState(() => (draft ? draft.draft : emptyDraft()))
  const [tenant, setTenant] = useState(draft?.tenant || null)
  const [invoice, setInvoice] = useState(null)
  const [memoOpen, setMemoOpen] = useState(Boolean(draft?.draft?.memo))
  const [discountOpen, setDiscountOpen] = useState(
    Boolean(draft?.draft?.discount_pct > 0 || draft?.draft?.discount_cents > 0)
  )
  const [logoBusy, setLogoBusy] = useState(false)
  const logoInputRef = useRef(null)

  // Load invoice when editing.
  useEffect(() => {
    if (!isEdit) return
    let cancelled = false
    setLoading(true)
    getInvoice(invoiceId)
      .then((data) => {
        if (cancelled) return
        setInvoice(data)
        if (data.tenant) setTenant(data.tenant)
        setForm({
          gig_id: data.gig_id,
          issue_date: data.issue_date ? String(data.issue_date).slice(0, 10) : null,
          due_date: data.due_date ? String(data.due_date).slice(0, 10) : null,
          payment_term_days: data.payment_term_days || 14,
          customer_name: data.customer_name || '',
          customer_contact_title: data.customer_contact_title || '',
          customer_contact_given_name: data.customer_contact_given_name || '',
          customer_contact_family_name: data.customer_contact_family_name || '',
          customer_address_street: data.customer_address_street || '',
          customer_address_postal_code: data.customer_address_postal_code || '',
          customer_address_city: data.customer_address_city || '',
          customer_address_country: data.customer_address_country || '',
          customer_email: data.customer_email || '',
          customer_kvk: data.customer_kvk || '',
          customer_tax_id: data.customer_tax_id || '',
          memo: data.memo || null,
          tax_inclusive: !!data.tax_inclusive,
          invert_logo: !!data.invert_logo,
          discount_type: data.discount_type === 'pct' ? 'pct' : 'eur',
          discount_pct: Number(data.discount_pct) || 0,
          discount_cents: Number(data.discount_cents) || 0,
          lines: (data.lines || []).map((l, i) => ({
            description: l.description || '',
            quantity: Number(l.quantity) || 1,
            unit_price_cents: Number(l.unit_price_cents) || 0,
            tax_percentage: Number(l.tax_percentage) || 0,
            position: l.position ?? i,
          })),
        })
        setMemoOpen(Boolean(data.memo))
        setDiscountOpen(Number(data.discount_pct) > 0 || Number(data.discount_cents) > 0)
      })
      .catch((e) => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [isEdit, invoiceId])

  // Recompute due_date when issue_date or payment_term_days change.
  useEffect(() => {
    if (!form.issue_date) return
    const computed = addDays(form.issue_date, form.payment_term_days || 14)
    if (computed && computed !== form.due_date) {
      setForm((prev) => ({ ...prev, due_date: computed }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.issue_date, form.payment_term_days])

  const finalized = Boolean(invoice?.finalized_at)
  const readOnly = isEdit && finalized
  const appliesKor = Boolean(tenant?.applies_kor)

  const totals = useMemo(() => computeInvoiceTotals({
    lines: form.lines,
    taxInclusive: form.tax_inclusive,
    discountType: form.discount_type,
    discountPct: form.discount_pct,
    discountCents: form.discount_cents,
    appliesKor,
  }), [form.lines, form.tax_inclusive, form.discount_type, form.discount_pct, form.discount_cents, appliesKor])

  function patchForm(patch) {
    setForm((prev) => ({ ...prev, ...patch }))
  }

  function patchLine(index, patch) {
    setForm((prev) => ({
      ...prev,
      lines: prev.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)),
    }))
  }

  function addLine() {
    setForm((prev) => ({
      ...prev,
      lines: [
        ...prev.lines,
        {
          description: '',
          quantity: 1,
          unit_price_cents: 0,
          tax_percentage: appliesKor ? 0 : Number(tenant?.tax_percentage ?? 9),
          position: prev.lines.length,
        },
      ],
    }))
  }

  function removeLine(index) {
    setForm((prev) => ({ ...prev, lines: prev.lines.filter((_, i) => i !== index) }))
  }

  function buildPayload() {
    return {
      gig_id: form.gig_id ?? null,
      issue_date: form.issue_date,
      due_date: form.due_date,
      payment_term_days: form.payment_term_days,
      customer_name: form.customer_name?.trim() || '',
      customer_contact_title: form.customer_contact_title?.trim() || null,
      customer_contact_given_name: form.customer_contact_given_name?.trim() || null,
      customer_contact_family_name: form.customer_contact_family_name?.trim() || null,
      customer_address_street: form.customer_address_street || null,
      customer_address_postal_code: form.customer_address_postal_code || null,
      customer_address_city: form.customer_address_city || null,
      customer_address_country: form.customer_address_country || null,
      customer_email: form.customer_email || null,
      customer_kvk: form.customer_kvk || null,
      customer_tax_id: form.customer_tax_id || null,
      memo: form.memo || null,
      tax_inclusive: !!form.tax_inclusive,
      invert_logo: !!form.invert_logo,
      discount_type: form.discount_type,
      discount_pct: form.discount_type === 'pct' ? Math.max(0, Number(form.discount_pct) || 0) : 0,
      discount_cents: form.discount_type === 'eur' ? Math.max(0, Math.round(Number(form.discount_cents) || 0)) : 0,
      lines: form.lines.map((l, i) => ({
        description: l.description || '',
        quantity: Number(l.quantity) || 0,
        unit_price_cents: Math.round(Number(l.unit_price_cents) || 0),
        tax_percentage: Number(l.tax_percentage) || 0,
        position: i,
      })),
    }
  }

  async function handleSave() {
    if (!form.customer_name?.trim()) {
      setError('Customer name is required')
      return
    }
    if (!form.lines.length || !form.lines.some((l) => l.description?.trim())) {
      setError('At least one line with a description is required')
      return
    }
    try {
      setSaving(true)
      setError(null)
      if (isEdit) {
        await updateInvoice(invoiceId, buildPayload())
      } else {
        await createInvoice(buildPayload())
      }
      onClose(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleStatusChange(newStatus) {
    if (!isEdit) return
    try {
      setSaving(true)
      setError(null)
      const updated = await updateInvoice(invoiceId, { status: newStatus })
      setInvoice(updated)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!isEdit) return
    setDeleteDialogOpen(true)
  }

  async function confirmDelete() {
    setDeleteDialogOpen(false)
    try {
      await deleteInvoice(invoiceId)
      onClose(true)
    } catch (e) {
      setError(e.message)
    }
  }

  async function handleLogoFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!isEdit) {
      setError('Save the invoice first, then upload a custom logo.')
      return
    }
    try {
      setLogoBusy(true)
      setError(null)
      await uploadInvoiceLogo(invoiceId, file)
      const refreshed = await getInvoice(invoiceId)
      setInvoice(refreshed)
    } catch (err) {
      setError(err.message)
    } finally {
      setLogoBusy(false)
    }
  }

  async function handleLogoRemove() {
    if (!isEdit) return
    try {
      setLogoBusy(true)
      await removeInvoiceLogo(invoiceId)
      const refreshed = await getInvoice(invoiceId)
      setInvoice(refreshed)
    } catch (err) {
      setError(err.message)
    } finally {
      setLogoBusy(false)
    }
  }

  const logoKey = invoice?.custom_logo_path || tenant?.logo_path
  const bandHeading = tenant?.formal_name || tenant?.band_name || ''

  if (loading) {
    const spinner = (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    )
    if (embedded) return spinner
    return (
      <Dialog open fullWidth maxWidth="md" onClose={() => onClose(false)}>
        <DialogContent>{spinner}</DialogContent>
      </Dialog>
    )
  }

  const titleNode = (
    <>
      <Box sx={{ flexGrow: 1 }}>
        {isEdit ? `Invoice ${invoice?.invoice_number || ''}` : 'New invoice'}
      </Box>
      {isEdit && invoice && (
        <Chip
          size="small"
          color={invoiceStatusColor(invoice.status)}
          label={invoice.status}
        />
      )}
      {!embedded && (
        <IconButton size="small" onClick={() => onClose(false)} aria-label="close">
          <CloseIcon />
        </IconButton>
      )}
    </>
  )

  const bodyNode = (
    <>
      {finalized && (
        <Alert severity="info" sx={{ mb: 2 }}>
          This invoice is finalized. Voiding and re-issuing is required to make corrections.
        </Alert>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
      )}

      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, mb: 3 }}>
        <Box>
          <input
            ref={logoInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            style={{ display: 'none' }}
            onChange={handleLogoFile}
          />
          {logoKey ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box
                component="img"
                src={`/api/files/${logoKey}`}
                alt="Invoice logo"
                sx={{ maxHeight: 64, maxWidth: 160, objectFit: 'contain', borderRadius: 1, border: '1px solid', borderColor: 'divider', p: 0.5 }}
              />
              {!readOnly && isEdit && (
                <Stack direction="row" spacing={0.5}>
                  <Button size="small" disabled={logoBusy} onClick={() => logoInputRef.current?.click()}>
                    Replace
                  </Button>
                  {invoice?.custom_logo_path && (
                    <Button size="small" disabled={logoBusy} onClick={handleLogoRemove}>
                      Remove
                    </Button>
                  )}
                </Stack>
              )}
            </Box>
          ) : (
            <Button
              startIcon={<ImageIcon />}
              disabled={readOnly || !isEdit || logoBusy}
              onClick={() => logoInputRef.current?.click()}
              variant="outlined"
            >
              Add logo
            </Button>
          )}
          {!isEdit && !logoKey && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              Save the invoice first to upload a custom logo.
            </Typography>
          )}
          {(logoKey || isEdit) && (
            <FormControlLabel
              sx={{ mt: 0.5 }}
              control={
                <Switch
                  size="small"
                  checked={!!form.invert_logo}
                  onChange={(e) => patchForm({ invert_logo: e.target.checked })}
                  disabled={readOnly}
                />
              }
              label={<Typography variant="caption">Invert logo colors</Typography>}
            />
          )}
        </Box>

        <Box sx={{ textAlign: 'right' }}>
          <Typography variant="subtitle2" fontWeight={700}>{bandHeading}</Typography>
          {tenant?.address_street && (
            <Typography variant="body2">{tenant.address_street}</Typography>
          )}
          {(tenant?.address_postal_code || tenant?.address_city) && (
            <Typography variant="body2">
              {[tenant?.address_postal_code, tenant?.address_city].filter(Boolean).join(' ')}
            </Typography>
          )}
          {tenant?.address_country && (
            <Typography variant="body2">{tenant.address_country}</Typography>
          )}
          {tenant?.kvk_number && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>KVK {tenant.kvk_number}</Typography>
          )}
          {tenant?.tax_id && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>BTW {tenant.tax_id}</Typography>
          )}
        </Box>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr 1fr' }, gap: 2, mb: 2 }}>
        <TextField
          label="Issue date"
          type="date"
          size="small"
          value={form.issue_date || ''}
          onChange={(e) => patchForm({ issue_date: e.target.value })}
          slotProps={{ inputLabel: { shrink: true } }}
          disabled={readOnly}
        />
        <FormControl size="small" disabled={readOnly}>
          <InputLabel>Payment term</InputLabel>
          <Select
            label="Payment term"
            value={form.payment_term_days}
            onChange={(e) => patchForm({ payment_term_days: Number(e.target.value) })}
          >
            {PAYMENT_TERMS.map((p) => (
              <MenuItem key={p.value} value={p.value}>{p.label}</MenuItem>
            ))}
          </Select>
        </FormControl>
        {isEdit && (
          <FormControl size="small">
            <InputLabel>Status</InputLabel>
            <Select
              label="Status"
              value={invoice?.status || 'draft'}
              onChange={(e) => handleStatusChange(e.target.value)}
            >
              {STATUS_OPTIONS.map((s) => (
                <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
      </Box>

      <Typography variant="subtitle2" sx={{ mb: 1 }}>Customer</Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 2 }}>
        <TextField
          label="Organisation name"
          size="small"
          required
          value={form.customer_name}
          onChange={(e) => patchForm({ customer_name: e.target.value })}
          disabled={readOnly}
        />
        <TextField
          label="Email"
          size="small"
          value={form.customer_email || ''}
          onChange={(e) => patchForm({ customer_email: e.target.value })}
          disabled={readOnly}
        />
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField
            label="Title"
            size="small"
            sx={{ width: 100 }}
            value={form.customer_contact_title || ''}
            onChange={(e) => patchForm({ customer_contact_title: e.target.value })}
            disabled={readOnly}
            placeholder="e.g. Dhr."
          />
          <TextField
            label="Given name"
            size="small"
            sx={{ flexGrow: 1 }}
            value={form.customer_contact_given_name || ''}
            onChange={(e) => patchForm({ customer_contact_given_name: e.target.value })}
            disabled={readOnly}
          />
          <TextField
            label="Family name"
            size="small"
            sx={{ flexGrow: 1 }}
            value={form.customer_contact_family_name || ''}
            onChange={(e) => patchForm({ customer_contact_family_name: e.target.value })}
            disabled={readOnly}
          />
        </Box>
        <TextField
          label="Street and number"
          size="small"
          value={form.customer_address_street || ''}
          onChange={(e) => patchForm({ customer_address_street: e.target.value })}
          disabled={readOnly}
        />
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField
            label="Postal code"
            size="small"
            sx={{ width: 140 }}
            value={form.customer_address_postal_code || ''}
            onChange={(e) => patchForm({ customer_address_postal_code: e.target.value })}
            disabled={readOnly}
          />
          <TextField
            label="City"
            size="small"
            sx={{ flexGrow: 1 }}
            value={form.customer_address_city || ''}
            onChange={(e) => patchForm({ customer_address_city: e.target.value })}
            disabled={readOnly}
          />
        </Box>
        <TextField
          label="Country"
          size="small"
          value={form.customer_address_country || ''}
          onChange={(e) => patchForm({ customer_address_country: e.target.value })}
          disabled={readOnly}
        />
        <TextField
          label="Customer KVK (optional)"
          size="small"
          value={form.customer_kvk || ''}
          onChange={(e) => patchForm({ customer_kvk: e.target.value })}
          disabled={readOnly}
        />
      </Box>

      {!memoOpen ? (
        <Button size="small" startIcon={<AddIcon />} disabled={readOnly} onClick={() => setMemoOpen(true)}>
          Add memo
        </Button>
      ) : (
        <TextField
          label="Memo"
          multiline
          minRows={2}
          fullWidth
          size="small"
          sx={{ mb: 2 }}
          value={form.memo || ''}
          onChange={(e) => patchForm({ memo: e.target.value })}
          disabled={readOnly}
        />
      )}

      <Divider sx={{ my: 2 }} />

      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>Items</Typography>
        {!appliesKor && (
          <ToggleButtonGroup
            value={form.tax_inclusive ? 'inclusive' : 'exclusive'}
            exclusive
            size="small"
            onChange={(_e, v) => v && patchForm({ tax_inclusive: v === 'inclusive' })}
            disabled={readOnly}
          >
            <ToggleButton value="inclusive">Inclusive VAT</ToggleButton>
            <ToggleButton value="exclusive">Exclusive VAT</ToggleButton>
          </ToggleButtonGroup>
        )}
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: '2fr 0.6fr 1fr 0.7fr 1fr 32px', gap: 1, alignItems: 'center', mb: 0.5 }}>
        <Typography variant="caption" color="text.secondary">Description</Typography>
        <Typography variant="caption" color="text.secondary" align="right">Qty</Typography>
        <Typography variant="caption" color="text.secondary" align="right">Price</Typography>
        {!appliesKor
          ? <Typography variant="caption" color="text.secondary" align="right">VAT %</Typography>
          : <span />
        }
        <Typography variant="caption" color="text.secondary" align="right">Total</Typography>
        <span />
      </Box>

      {form.lines.map((line, idx) => {
        const lineTotals = totals.perLine[idx] || { grossCents: 0 }
        return (
          <Box
            key={idx}
            sx={{ display: 'grid', gridTemplateColumns: '2fr 0.6fr 1fr 0.7fr 1fr 32px', gap: 1, alignItems: 'center', mb: 1 }}
          >
            <TextField
              size="small"
              placeholder="Start typing…"
              value={line.description}
              onChange={(e) => patchLine(idx, { description: e.target.value })}
              disabled={readOnly}
            />
            <TextField
              size="small"
              type="number"
              slotProps={{ htmlInput: { min: 0, step: 0.25 } }}
              value={line.quantity}
              onChange={(e) => patchLine(idx, { quantity: Number(e.target.value) || 0 })}
              disabled={readOnly}
            />
            <MoneyInput
              cents={line.unit_price_cents}
              onChange={(c) => patchLine(idx, { unit_price_cents: c })}
              disabled={readOnly}
            />
            {!appliesKor ? (
              <TextField
                size="small"
                type="number"
                value={line.tax_percentage}
                onChange={(e) => patchLine(idx, { tax_percentage: Number(e.target.value) || 0 })}
                slotProps={{
                  htmlInput: { min: 0, step: 1 },
                  input: { endAdornment: <InputAdornment position="end">%</InputAdornment> },
                }}
                disabled={readOnly}
              />
            ) : (
              <span />
            )}
            <Typography variant="body2" align="right">
              {formatEur(form.tax_inclusive ? lineTotals.grossCents : lineTotals.netCents)}
            </Typography>
            <IconButton
              size="small"
              onClick={() => removeLine(idx)}
              disabled={readOnly || form.lines.length <= 1}
              aria-label="remove line"
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Box>
        )
      })}

      <Button size="small" startIcon={<AddIcon />} disabled={readOnly} onClick={addLine}>
        Add item
      </Button>

      <Divider sx={{ my: 2 }} />

      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Box sx={{ minWidth: 320 }}>
          <Row label="Subtotal" value={formatEur(totals.subtotalCents)} />
          {discountOpen ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
              <Typography variant="body2" sx={{ flexGrow: 1 }}>Discount</Typography>
              {form.discount_type === 'pct' ? (
                <TextField
                  size="small"
                  type="number"
                  sx={{ width: 80 }}
                  value={form.discount_pct}
                  onChange={(e) => patchForm({ discount_pct: Math.max(0, Number(e.target.value) || 0) })}
                  slotProps={{ htmlInput: { min: 0, max: 100, step: 0.01 } }}
                  disabled={readOnly}
                />
              ) : (
                <MoneyInput
                  cents={form.discount_cents}
                  onChange={(c) => patchForm({ discount_cents: c })}
                  disabled={readOnly}
                  sx={{ width: 80 }}
                />
              )}
              <Select
                size="small"
                value={form.discount_type}
                onChange={(e) => patchForm({ discount_type: e.target.value, discount_pct: 0, discount_cents: 0 })}
                disabled={readOnly}
                sx={{ minWidth: 70 }}
              >
                <MenuItem value="pct">%</MenuItem>
                <MenuItem value="eur">€</MenuItem>
              </Select>
              <Typography variant="body2" sx={{ minWidth: 80, textAlign: 'right' }}>
                {formatEur(-totals.discountCents)}
              </Typography>
              <IconButton
                size="small"
                disabled={readOnly}
                onClick={() => { patchForm({ discount_pct: 0, discount_cents: 0 }); setDiscountOpen(false) }}
                aria-label="remove discount"
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          ) : (
            <Button size="small" startIcon={<AddIcon />} disabled={readOnly} onClick={() => setDiscountOpen(true)}>
              Add discount
            </Button>
          )}
          {!appliesKor && totals.vatByRate.map(({ rate, cents }) => (
            <Row key={rate} label={`VAT ${rate}%`} value={formatEur(cents)} />
          ))}
          {appliesKor && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'right' }}>
              Kleine ondernemersregeling — no VAT charged.
            </Typography>
          )}
          <Divider sx={{ my: 1 }} />
          <Row label={<strong>Total</strong>} value={<strong>{formatEur(totals.totalCents)}</strong>} />
        </Box>
      </Box>
    </>
  )

  const actionsNode = (
    <>
      <Box>
        {isEdit && !finalized && (
          <Button color="error" onClick={handleDelete} startIcon={<DeleteIcon />}>
            Delete
          </Button>
        )}
      </Box>
      <Box sx={{ display: 'flex', gap: 1 }}>
        {isEdit && invoice?.pdf_path && (
          <Button
            component="a"
            href={`/api/files/${invoice.pdf_path}`}
            target="_blank"
            rel="noopener noreferrer"
            startIcon={<DownloadIcon />}
          >
            Download PDF
          </Button>
        )}
        {!readOnly && (
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Save'}
          </Button>
        )}
      </Box>
    </>
  )

  const deleteConfirmDialog = (
    <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
      <DialogTitle>Delete invoice?</DialogTitle>
      <DialogContent>
        Delete invoice {invoice?.invoice_number}? Cannot be undone.
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
        <Button color="error" variant="contained" onClick={confirmDelete}>Delete</Button>
      </DialogActions>
    </Dialog>
  )

  if (embedded) {
    return (
      <>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            {titleNode}
          </Box>
          <Divider sx={{ mb: 2 }} />
          <Box>{bodyNode}</Box>
          <Divider sx={{ mt: 3, mb: 2 }} />
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            {actionsNode}
          </Box>
        </Box>
        {deleteConfirmDialog}
      </>
    )
  }

  return (
    <>
      <Dialog open fullWidth maxWidth="md" onClose={() => onClose(false)}>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {titleNode}
        </DialogTitle>
        <DialogContent dividers>{bodyNode}</DialogContent>
        <DialogActions sx={{ justifyContent: 'space-between' }}>{actionsNode}</DialogActions>
      </Dialog>
      {deleteConfirmDialog}
    </>
  )
}

function Row({ label, value }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 0.5 }}>
      <Typography variant="body2">{label}</Typography>
      <Typography variant="body2">{value}</Typography>
    </Box>
  )
}

// Lets the user type freely (e.g. "200") and only commits the parsed cent value on blur,
// preventing the controlled-input loop where every keystroke reformats the display value.
function MoneyInput({ cents, onChange, disabled, sx }) {
  const [raw, setRaw] = useState('')
  const [focused, setFocused] = useState(false)

  return (
    <TextField
      size="small"
      value={focused ? raw : centsToEditableEuro(cents)}
      onChange={(e) => setRaw(e.target.value)}
      onFocus={(e) => {
        setRaw(centsToEditableEuro(cents))
        setFocused(true)
        e.target.select()
      }}
      onBlur={() => {
        setFocused(false)
        onChange(parseEuroInput(raw))
      }}
      disabled={disabled}
      sx={sx}
      slotProps={{ input: { startAdornment: <InputAdornment position="start">€</InputAdornment> } }}
    />
  )
}
