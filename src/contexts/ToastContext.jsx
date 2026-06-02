import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import PropTypes from 'prop-types'
import Snackbar from '@mui/material/Snackbar'
import Alert from '@mui/material/Alert'

const ToastContext = createContext(null)

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null)

  const showToast = useCallback((message, severity = 'error') => {
    setToast({ message: String(message), severity })
  }, [])

  const handleClose = useCallback((_, reason) => {
    if (reason === 'clickaway') return
    setToast(null)
  }, [])

  useEffect(() => {
    function handleError(event) {
      const message = event.error?.message || event.message || 'An unexpected error occurred'
      showToast(message)
    }

    function handleRejection(event) {
      const message = event.reason?.message || String(event.reason) || 'An unexpected error occurred'
      showToast(message)
    }

    window.addEventListener('error', handleError)
    window.addEventListener('unhandledrejection', handleRejection)
    return () => {
      window.removeEventListener('error', handleError)
      window.removeEventListener('unhandledrejection', handleRejection)
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

ToastProvider.propTypes = {
  children: PropTypes.node.isRequired,
}

export function useToast() {
  return useContext(ToastContext)
}
