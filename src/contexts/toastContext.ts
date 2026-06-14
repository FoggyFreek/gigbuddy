import { createContext, useContext } from 'react'

export type ToastSeverity = 'error' | 'warning' | 'info' | 'success'

/** Function to show a toast: showToast(message, severity?) */
export type ShowToast = (message: string, severity?: ToastSeverity) => void

export const ToastContext = createContext<ShowToast | null>(null)

export function useToast(): ShowToast | null {
  return useContext(ToastContext)
}
