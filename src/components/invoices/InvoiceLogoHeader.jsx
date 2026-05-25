import PropTypes from 'prop-types'
import { invoiceShape, tenantShape } from '../../propTypes/shared.js'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import FormControlLabel from '@mui/material/FormControlLabel'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import Typography from '@mui/material/Typography'
import ImageIcon from '@mui/icons-material/Image'

export default function InvoiceLogoHeader({
  isEdit, readOnly, logoKey, invoice, tenant, bandHeading,
  logoBusy, logoInputRef, onLogoFile, onLogoRemove, form, patchForm,
}) {
  const hasCustomLogo = Boolean(invoice?.custom_logo_path)
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, mb: 3 }}>
      <Box>
        <input
          ref={logoInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          style={{ display: 'none' }}
          onChange={onLogoFile}
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
                {hasCustomLogo && (
                  <Button size="small" disabled={logoBusy} onClick={onLogoRemove}>
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
  )
}

InvoiceLogoHeader.propTypes = {
  isEdit: PropTypes.bool.isRequired,
  readOnly: PropTypes.bool.isRequired,
  logoKey: PropTypes.string,
  invoice: invoiceShape,
  tenant: tenantShape,
  bandHeading: PropTypes.string,
  logoBusy: PropTypes.bool,
  logoInputRef: PropTypes.shape({ current: PropTypes.any }).isRequired,
  onLogoFile: PropTypes.func.isRequired,
  onLogoRemove: PropTypes.func.isRequired,
  form: PropTypes.object.isRequired,
  patchForm: PropTypes.func.isRequired,
}
