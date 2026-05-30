import { useState } from 'react'
import PropTypes from 'prop-types'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import CheckIcon from '@mui/icons-material/Check'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'

export default function CopyIconButton({ value, edge = false, ariaLabel = 'copy' }) {
  const [copied, setCopied] = useState(false)
  if (!value) return null
  function handleCopy() {
    navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <Tooltip title={copied ? 'Copied!' : 'Copy'}>
      <IconButton size="small" edge={edge} onClick={handleCopy} tabIndex={-1} aria-label={ariaLabel}>
        {copied ? <CheckIcon fontSize="small" color="success" /> : <ContentCopyIcon fontSize="small" />}
      </IconButton>
    </Tooltip>
  )
}

CopyIconButton.propTypes = {
  value: PropTypes.string,
  edge: PropTypes.oneOf(['start', 'end', false]),
  ariaLabel: PropTypes.string,
}
