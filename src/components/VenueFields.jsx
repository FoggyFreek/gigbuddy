import FormControl from '@mui/material/FormControl'
import Grid from '@mui/material/Grid'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import InputLabel from '@mui/material/InputLabel'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import CopyAdornment from './CopyAdornment.jsx'

export default function VenueFields({ form, onChange, errors = {} }) {
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
            <MenuItem value="venue">Venue</MenuItem>
            <MenuItem value="festival">Festival</MenuItem>
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
          label="City"
          fullWidth
          value={form.city}
          onChange={(e) => onChange('city', e.target.value)}
        />
      </Grid>
      <Grid size={3}>
        <TextField
          label="Country"
          fullWidth
          value={form.country}
          onChange={(e) => onChange('country', e.target.value.slice(0, 2).toUpperCase())}
          slotProps={{ htmlInput: { maxLength: 2 } }}
          placeholder="NL"
        />
      </Grid>
      <Grid size={3}>
        <TextField
          label="Province"
          fullWidth
          value={form.province}
          onChange={(e) => onChange('province', e.target.value.slice(0, 2).toUpperCase())}
          slotProps={{ htmlInput: { maxLength: 2 } }}
          placeholder="NH"
        />
      </Grid>
      <Grid size={12}>
        <TextField
          label="Address"
          fullWidth
          value={form.address}
          onChange={(e) => onChange('address', e.target.value)}
        />
      </Grid>
      <Grid size={12}>
        <TextField
          label="Website"
          fullWidth
          value={form.website}
          onChange={(e) => onChange('website', e.target.value)}
          placeholder="https://"
          slotProps={{
            input: {
              endAdornment: form.website ? (
                <InputAdornment position="end">
                  <Tooltip title="Open in new tab">
                    <IconButton
                      size="small"
                      edge="end"
                      tabIndex={-1}
                      component="a"
                      href={form.website}
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
      <Grid size={6}>
        <TextField
          label="Contact Person"
          fullWidth
          value={form.contact_person}
          onChange={(e) => onChange('contact_person', e.target.value)}
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
      <Grid size={12}>
        <TextField
          label="Email"
          fullWidth
          type="email"
          value={form.email}
          onChange={(e) => onChange('email', e.target.value)}
          slotProps={{ input: { endAdornment: <CopyAdornment value={form.email} /> } }}
        />
      </Grid>
    </>
  )
}
