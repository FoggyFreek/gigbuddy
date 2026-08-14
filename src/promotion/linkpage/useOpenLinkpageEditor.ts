import { useCallback, useState } from 'react'
import { createLinkpageHandoff } from './linkpage.ts'
import { useToast } from '../../contexts/toastContext.ts'

/**
 * Opens the decoupled link-page editor in a new tab with a freshly minted
 * handoff token. The token is short-lived, so it is always minted at click
 * time — never on mount and never reused.
 *
 * The failure message is passed in so each surface keeps its own i18n
 * namespace, rather than this hook reaching into one of them.
 */
export function useOpenLinkpageEditor(errorMessage: string) {
  const showToast = useToast()
  const [opening, setOpening] = useState(false)

  const open = useCallback(async () => {
    setOpening(true)
    try {
      const { url } = await createLinkpageHandoff()
      window.open(url, '_blank', 'noopener')
    } catch {
      showToast?.(errorMessage, 'error')
    } finally {
      setOpening(false)
    }
  }, [errorMessage, showToast])

  return { open, opening }
}
