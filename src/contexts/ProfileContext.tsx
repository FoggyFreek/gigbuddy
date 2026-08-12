import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ProfileContext } from './profileContext.ts'
import { getProfile } from '../people/profiles/profile.ts'
import { useAuth } from './authContext.ts'
import {
  EMPTY_INTEGRATION_CONFIGURATION,
  isIntegrationConfigured as checkIntegrationConfigured,
} from '../utils/integrations.ts'
import type { IntegrationConfiguration, IntegrationName } from '../utils/integrations.ts'
import type { Id } from '../types/entities.ts'

interface ProfileProviderProps {
  children: ReactNode
}

export function ProfileProvider({ children }: Readonly<ProfileProviderProps>) {
  const { user } = useAuth()
  const activeTenantId = user?.activeTenantId ?? null
  const [bandName, setBandName] = useState('')
  const [accentColor, setAccentColor] = useState<string | null>(null)
  const [integrationState, setIntegrationState] = useState<{
    tenantId: Id | null
    configuration: IntegrationConfiguration
  }>({ tenantId: null, configuration: EMPTY_INTEGRATION_CONFIGURATION })

  useEffect(() => {
    let cancelled = false
    Promise.resolve(activeTenantId ? getProfile() : null)
      .then((p) => {
        if (cancelled) return
        setBandName(p?.band_name || '')
        setAccentColor(p?.accent_color || null)
        setIntegrationState({
          tenantId: activeTenantId,
          configuration: p?.integrations ?? EMPTY_INTEGRATION_CONFIGURATION,
        })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [activeTenantId])

  const integrations = integrationState.tenantId === activeTenantId
    ? integrationState.configuration
    : null

  const isIntegrationConfigured = useCallback(
    (integration: IntegrationName) => checkIntegrationConfigured(integrations, integration),
    [integrations],
  )

  const setIntegrationConfigured = useCallback((integration: IntegrationName, configured: boolean) => {
    setIntegrationState((current) => ({
      tenantId: activeTenantId,
      configuration: {
        ...(current.tenantId === activeTenantId
          ? current.configuration
          : EMPTY_INTEGRATION_CONFIGURATION),
        [integration]: configured,
      },
    }))
  }, [activeTenantId])

  const value = useMemo(
    () => ({
      bandName, setBandName, accentColor, setAccentColor,
      integrations, isIntegrationConfigured, setIntegrationConfigured,
    }),
    [bandName, accentColor, integrations, isIntegrationConfigured, setIntegrationConfigured],
  )

  return (
    <ProfileContext.Provider value={value}>
      {children}
    </ProfileContext.Provider>
  )
}
