import { useTranslation } from 'react-i18next'
import FormControl from '@mui/material/FormControl'
import Grid from '@mui/material/Grid'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import TextField from '@mui/material/TextField'
import CopyAdornment from './CopyAdornment.tsx'
import { ALL_CONTACT_CATEGORIES, useContactCategoryLabel } from '../utils/contactCategories.ts'

interface ContactFieldsProps {
  form: { name: string; email: string; phone: string; category: string }
  onChange: (field: string, value: string) => void
  errors?: Record<string, string | undefined>
  categories?: string[]
  disabled?: boolean
}

export default function ContactFields({ form, onChange, errors = {}, categories = ALL_CONTACT_CATEGORIES, disabled = false }: ContactFieldsProps) {
  const { t } = useTranslation('contacts')
  const categoryLabel = useContactCategoryLabel()
  return (
    <>
      <Grid size={4}>
        <FormControl fullWidth>
          <InputLabel>{t($ => $.fields.category)}</InputLabel>
          <Select
            label={t($ => $.fields.category)}
            value={form.category}
            onChange={(e) => onChange('category', e.target.value)}
            disabled={disabled}
          >
            {categories.map((cat) => (
              <MenuItem key={cat} value={cat}>{categoryLabel(cat)}</MenuItem>
            ))}
          </Select>
        </FormControl>
      </Grid>
      <Grid size={8}>
        <TextField
          label={t($ => $.fields.name)}
          fullWidth
          required
          value={form.name}
          onChange={(e) => onChange('name', e.target.value)}
          error={!!errors.name}
          helperText={errors.name}
          disabled={disabled}
        />
      </Grid>
      <Grid size={6}>
        <TextField
          label={t($ => $.fields.email)}
          fullWidth
          type="email"
          value={form.email}
          onChange={(e) => onChange('email', e.target.value)}
          slotProps={{ input: { endAdornment: <CopyAdornment value={form.email} /> } }}
          disabled={disabled}
        />
      </Grid>
      <Grid size={6}>
        <TextField
          label={t($ => $.fields.phone)}
          fullWidth
          value={form.phone}
          onChange={(e) => onChange('phone', e.target.value)}
          slotProps={{ input: { endAdornment: <CopyAdornment value={form.phone} /> } }}
          disabled={disabled}
        />
      </Grid>
    </>
  )
}
