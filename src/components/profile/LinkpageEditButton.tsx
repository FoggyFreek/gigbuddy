import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@mui/material/Button'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import { getLinkpageStatus, createLinkpageHandoff } from '../../api/linkpage.ts'
import { useToast } from '../../contexts/toastContext.ts'

// Opens the decoupled link-page editor (linkpage/ app) with a fresh handoff
// token. Hidden entirely while the integration isn't configured server-side.
export default function LinkpageEditButton() {
  const { t } = useTranslation('profile')
  const showToast = useToast()
  const [configured, setConfigured] = useState(false)
  const [opening, setOpening] = useState(false)

  useEffect(() => {
    let cancelled = false
    getLinkpageStatus()
      .then((status) => {
        if (!cancelled) setConfigured(status.configured)
      })
      .catch(() => {
        /* stays hidden */
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!configured) return null

  const open = async () => {
    setOpening(true)
    try {
      const { url } = await createLinkpageHandoff()
      window.open(url, '_blank', 'noopener')
    } catch {
      showToast?.(t($ => $.linkpage.error), 'error')
    } finally {
      setOpening(false)
    }
  }

  return (
    <Button
      size="small"
      variant="outlined"
      startIcon={<OpenInNewIcon />}
      onClick={open}
      disabled={opening}
      sx={{ mr: 2 }}
    >
      {t($ => $.linkpage.edit)}
    </Button>
  )
}
