import Button from '@mui/material/Button'
import ButtonGroup from '@mui/material/ButtonGroup'

interface VoteToggleProps {
  vote?: string | null
  onChange: (vote: string | null) => void
}

export default function VoteToggle({ vote, onChange }: VoteToggleProps) {
  return (
    <ButtonGroup size="small" variant="outlined">
      <Button
        variant={vote === 'yes' ? 'contained' : 'outlined'}
        color="success"
        onClick={() => onChange(vote === 'yes' ? null : 'yes')}
      >
        Yes
      </Button>
      <Button
        variant={vote === 'no' ? 'contained' : 'outlined'}
        color="error"
        onClick={() => onChange(vote === 'no' ? null : 'no')}
      >
        No
      </Button>
    </ButtonGroup>
  )
}
