import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import CssBaseline from '@mui/material/CssBaseline'
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { ThemeContextProvider } from './contexts/ThemeContext.tsx'
import { TenantThemeProvider } from './contexts/TenantThemeProvider.tsx'
import { ToastProvider } from './contexts/ToastContext.tsx'
import App from './App.tsx'
import { AuthProvider } from './contexts/AuthContext.tsx'
import { ProfileProvider } from './contexts/ProfileContext.tsx'
import './i18n/index.ts'
import '@fontsource/bebas-neue/400.css'
import '@fontsource/lato/400.css'
import '@fontsource/lato/700.css'
import '@fontsource/montserrat/400.css'
import '@fontsource/montserrat/500.css'
import '@fontsource/montserrat/700.css'
import './index.css'

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeContextProvider>
      <CssBaseline />
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <BrowserRouter>
          <AuthProvider>
            <ProfileProvider>
              <TenantThemeProvider>
                <ToastProvider>
                  <App />
                </ToastProvider>
              </TenantThemeProvider>
            </ProfileProvider>
          </AuthProvider>
        </BrowserRouter>
      </LocalizationProvider>
    </ThemeContextProvider>
  </StrictMode>,
)
