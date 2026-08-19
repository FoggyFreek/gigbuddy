import Autocomplete from '@mui/material/Autocomplete'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { resolveTypedLabel } from '../../infoBlockLabels.ts'
import type { InfoBlockLabelOption, InfoBlockLabelValue } from '../../infoBlockLabels.ts'

// The label *is* the block's caption, so the editable control is dressed as one
// — uppercase, small, no underline — rather than as a form field sitting above
// the text. Uppercasing is presentation only; the label is stored as written.
const CAPTION_SX = {
  textTransform: 'uppercase',
  fontSize: '0.6875rem',
  fontWeight: 600,
  letterSpacing: '0.08em',
  lineHeight: 1.66,
  color: 'text.secondary',
  // The input inherits from the InputBase root, but say it outright so a theme
  // font-size on .MuiInputBase-input cannot quietly win.
  '& .MuiInputBase-input': {
    textTransform: 'uppercase',
    fontSize: '0.6875rem',
    fontWeight: 600,
    letterSpacing: '0.08em',
    py: 0,
  },
} as const

interface Props {
  /** The label as displayed: the user's own text, or the translated key. */
  value: string
  options: InfoBlockLabelOption[]
  editable: boolean
  fieldLabel: string
  onChange: (value: InfoBlockLabelValue) => void
}

export default function InfoBlockLabelField({
  value, options, editable, fieldLabel, onChange,
}: Readonly<Props>) {
  if (!editable) {
    return <Typography sx={{ ...CAPTION_SX, display: 'block' }}>{value}</Typography>
  }

  // Both routes in: picking a suggestion, and typing text and clicking away.
  // A typed label that matches a suggestion resolves to the same stored key, so
  // the two are interchangeable and re-committing the same text is a no-op.
  function commit(typed: string) {
    const resolved = resolveTypedLabel(typed, options)
    if (resolved) onChange(resolved)
  }

  return (
    <Autocomplete<InfoBlockLabelOption, false, true, true>
      freeSolo
      disableClearable
      openOnFocus
      // Uncontrolled on purpose: the field keeps what the user typed while they
      // type, and the parent only hears about it once it is committed.
      defaultValue={value}
      options={options}
      // `option` is a raw string at runtime whenever freeSolo passes the typed
      // text through, so never reach for a property without checking first.
      getOptionLabel={(option) => (typeof option === 'string' ? option : option.text)}
      isOptionEqualToValue={(option, selected) => {
        const selectedText = typeof selected === 'string' ? selected : selected.text
        return (typeof option === 'string' ? option : option.text) === selectedText
      }}
      onChange={(_event, picked) => {
        if (picked == null) return
        if (typeof picked === 'string') commit(picked)
        else onChange({ label: picked.key, label_is_custom: false })
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          variant="standard"
          placeholder={fieldLabel}
          onBlur={(event) => commit(event.target.value)}
          slotProps={{
            ...params.slotProps,
            input: { ...params.slotProps.input, disableUnderline: true, sx: CAPTION_SX },
            htmlInput: { ...params.slotProps.htmlInput, 'aria-label': fieldLabel },
          }}
        />
      )}
      sx={{ maxWidth: 320 }}
    />
  )
}
