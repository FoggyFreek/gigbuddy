import PropTypes from 'prop-types'
import FormControl from '@mui/material/FormControl'
import Grid from '@mui/material/Grid'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import TextField from '@mui/material/TextField'
import CopyAdornment from './CopyAdornment.jsx'
import { ALL_CONTACT_CATEGORIES, CONTACT_CATEGORY_LABELS } from '../utils/contactCategories.js'

export default function ContactFields({ form, onChange, errors = {}, categories = ALL_CONTACT_CATEGORIES }) {
  return (
    <>
      <Grid size={4}>
        <FormControl fullWidth>
          <InputLabel>Category</InputLabel>
          <Select
            label="Category"
            value={form.category}
            onChange={(e) => onChange('category', e.target.value)}
          >
            {categories.map((cat) => (
              <MenuItem key={cat} value={cat}>{CONTACT_CATEGORY_LABELS[cat]}</MenuItem>
            ))}
          </Select>
        </FormControl>
      </Grid>
      <Grid size={8}>
        <TextField
          label="Name"
          fullWidth
          required
          value={form.name}
          onChange={(e) => onChange('name', e.target.value)}
          error={!!errors.name}
          helperText={errors.name}
        />
      </Grid>
      <Grid size={6}>
        <TextField
          label="Email"
          fullWidth
          type="email"
          value={form.email}
          onChange={(e) => onChange('email', e.target.value)}
          slotProps={{ input: { endAdornment: <CopyAdornment value={form.email} /> } }}
        />
      </Grid>
      <Grid size={6}>
        <TextField
          label="Phone"
          fullWidth
          value={form.phone}
          onChange={(e) => onChange('phone', e.target.value)}
          slotProps={{ input: { endAdornment: <CopyAdornment value={form.phone} /> } }}
        />
      </Grid>
    </>
  )
}

ContactFields.propTypes = {
  form: PropTypes.shape({
    name: PropTypes.string,
    email: PropTypes.string,
    phone: PropTypes.string,
    category: PropTypes.string,
  }).isRequired,
  onChange: PropTypes.func.isRequired,
  errors: PropTypes.object,
  categories: PropTypes.arrayOf(PropTypes.string),
}
