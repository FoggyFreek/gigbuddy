import FormControl from '@mui/material/FormControl'
import Grid from '@mui/material/Grid'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import TextField from '@mui/material/TextField'
import CopyAdornment from './CopyAdornment.jsx'

const VALID_CATEGORIES = ['press', 'radio & tv', 'booker', 'promotion', 'network']

const CATEGORY_LABELS = {
  'press':      'Press',
  'radio & tv': 'Radio & TV',
  'booker':     'Booker',
  'promotion':  'Promotion',
  'network':    'Network',
}

export default function ContactFields({ form, onChange, errors = {} }) {
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
            {VALID_CATEGORIES.map((cat) => (
              <MenuItem key={cat} value={cat}>{CATEGORY_LABELS[cat]}</MenuItem>
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
