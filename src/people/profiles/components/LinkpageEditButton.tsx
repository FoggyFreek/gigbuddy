import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@mui/material/Button'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import { getLinkpageStatus } from '../../../promotion/linkpage/linkpage.ts'
import { useOpenLinkpageEditor } from '../../../promotion/linkpage/useOpenLinkpageEditor.ts'

// Opens the decoupled link-page editor (separate app) with a fresh handoff
// token. Hidden entirely while the integration isn't configured server-side.
export default function LinkpageEditButton() {
  const { t } = useTranslation('profile')
  const [configured, setConfigured] = useState(false)
  const { open, opening } = useOpenLinkpageEditor(t($ => $.linkpage.error))

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

  return (
    <Button
      size="small"
      variant="outlined"
      startIcon={<OpenInNewIcon />}
      onClick={open}
      disabled={opening}
    >
      {t($ => $.linkpage.edit)}
    </Button>
  )
}
