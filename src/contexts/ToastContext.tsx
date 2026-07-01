import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import Snackbar from '@mui/material/Snackbar'
import Alert from '@mui/material/Alert'
import { ToastContext } from './toastContext.ts'
import type { ToastSeverity } from './toastContext.ts'

interface ToastState {
  message: string
  severity: ToastSeverity
}

interface ToastProviderProps {
  children: ReactNode
}

export function ToastProvider({ children }: Readonly<ToastProviderProps>) {
  const [toast, setToast] = useState<ToastState | null>(null)

  const showToast = useCallback((message: string, severity: ToastSeverity = 'error') => {
    setToast({ message: String(message), severity })
  }, [])

  const handleClose = useCallback((_: unknown, reason?: string) => {
    if (reason === 'clickaway') return
    setToast(null)
  }, [])

  useEffect(() => {
    function handleError(event: ErrorEvent) {
      const message = event.error?.message || event.message || 'An unexpected error occurred'
      showToast(message)
    }

    function handleRejection(event: PromiseRejectionEvent) {
      const message = event.reason?.message || String(event.reason) || 'An unexpected error occurred'
      showToast(message)
    }

    globalThis.addEventListener('error', handleError)
    globalThis.addEventListener('unhandledrejection', handleRejection)
    return () => {
      globalThis.removeEventListener('error', handleError)
      globalThis.removeEventListener('unhandledrejection', handleRejection)
    }
  }, [showToast])

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <Snackbar
        open={!!toast}
        autoHideDuration={6000}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity={toast?.severity ?? 'error'}
          onClose={handleClose}
          variant="filled"
          sx={{ width: '100%' }}
        >
          {toast?.message}
        </Alert>
      </Snackbar>
    </ToastContext.Provider>
  )
}
