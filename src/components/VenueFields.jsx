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
import PropTypes from 'prop-types'

export default function VenueFields({ form, onChange, errors = {}, lockedCategory }) {
  const isFestival = form.category === 'festival'
  return (
    <>
      {!lockedCategory && (
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
      )}
      <Grid size={8}>
        <TextField
          label={isFestival ? 'Festival / event name' : 'Venue name'}
          fullWidth
          required
          value={form.name}
          onChange={(e) => onChange('name', e.target.value)}
          error={!!errors.name}
          helperText={errors.name}
        />
      </Grid>

      <Grid size={3}>
        <TextField
          label="Title"
          fullWidth
          value={form.title}
          onChange={(e) => onChange('title', e.target.value)}
          placeholder="Mr."
        />
      </Grid>
      <Grid size={4}>
        <TextField
          label="Given name"
          fullWidth
          value={form.given_name}
          onChange={(e) => onChange('given_name', e.target.value)}
        />
      </Grid>
      <Grid size={5}>
        <TextField
          label="Family name"
          fullWidth
          value={form.family_name}
          onChange={(e) => onChange('family_name', e.target.value)}
        />
      </Grid>

      <Grid size={12}>
        <TextField
          label="Organization name"
          fullWidth
          value={form.organization_name}
          onChange={(e) => onChange('organization_name', e.target.value)}
        />
      </Grid>

      <Grid size={8}>
        <TextField
          label="Street and number"
          fullWidth
          value={form.street_and_number}
          onChange={(e) => onChange('street_and_number', e.target.value)}
        />
      </Grid>
      <Grid size={4}>
        <TextField
          label="Postal code"
          fullWidth
          value={form.postal_code}
          onChange={(e) => onChange('postal_code', e.target.value)}
          placeholder="1234AB"
        />
      </Grid>
      <Grid size={12}>
        <TextField
          label="Street additional"
          fullWidth
          value={form.street_additional}
          onChange={(e) => onChange('street_additional', e.target.value)}
          placeholder="Apt. 1"
        />
      </Grid>

      <Grid size={5}>
        <TextField
          label="City"
          fullWidth
          value={form.city}
          onChange={(e) => onChange('city', e.target.value)}
        />
      </Grid>
      <Grid size={4}>
        <TextField
          label="Region"
          fullWidth
          value={form.region}
          onChange={(e) => onChange('region', e.target.value)}
          placeholder="Noord-Holland"
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
          label="Phone"
          fullWidth
          value={form.phone}
          onChange={(e) => onChange('phone', e.target.value)}
          slotProps={{ input: { endAdornment: <CopyAdornment value={form.phone} /> } }}
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
    </>
  )
}

VenueFields.propTypes = {
  form: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
  errors: PropTypes.object,
  lockedCategory: PropTypes.string,
}
