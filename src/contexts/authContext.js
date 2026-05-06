import { createContext, useContext } from 'react'

export const AuthContext = createContext({
  user: undefined,
  logout: () => {},
  switchTenant: async () => {},
  refreshUser: async () => {},
})

export function useAuth() {
  return useContext(AuthContext)
}
