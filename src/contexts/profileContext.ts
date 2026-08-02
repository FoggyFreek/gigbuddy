import { createContext, useContext } from 'react'
import {
  EMPTY_INTEGRATION_CONFIGURATION,
  isIntegrationConfigured as checkIntegrationConfigured,
} from '../utils/integrations.ts'
import type { IntegrationConfiguration, IntegrationName } from '../utils/integrations.ts'

export interface ProfileContextValue {
  bandName: string
  setBandName: (name: string) => void
  accentColor: string | null
  setAccentColor: (color: string | null) => void
  integrations: IntegrationConfiguration | null
  isIntegrationConfigured: (integration: IntegrationName) => boolean
  setIntegrationConfigured: (integration: IntegrationName, configured: boolean) => void
}

// The accounting regime (country, default VAT rate) is NOT here: it belongs to
// useAccountingProfile().
export const ProfileContext = createContext<ProfileContextValue>({
  bandName: '',
  setBandName: () => {},
  accentColor: null,
  setAccentColor: () => {},
  integrations: null,
  isIntegrationConfigured: (integration) => checkIntegrationConfigured(EMPTY_INTEGRATION_CONFIGURATION, integration),
  setIntegrationConfigured: () => {},
})

export function useProfile(): ProfileContextValue {
  return useContext(ProfileContext)
}
