import { createContext, useContext } from 'react'

export const AuthContext = createContext({ user: undefined, logout: () => {} })

export function useAuth() {
  return useContext(AuthContext)
}
