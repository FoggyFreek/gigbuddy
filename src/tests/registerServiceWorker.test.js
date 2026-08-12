import { afterEach, describe, expect, it, vi } from 'vitest'

import { registerServiceWorker } from '../registerServiceWorker.ts'

function setNavigator(value) {
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('registerServiceWorker', () => {
  it('registers the service worker when the browser supports it', async () => {
    const register = vi.fn().mockResolvedValue({ scope: '/' })
    setNavigator({ serviceWorker: { register } })

    await registerServiceWorker()

    expect(register).toHaveBeenCalledWith('/sw.js')
  })

  it('logs a failed registration instead of swallowing it', async () => {
    const register = vi.fn().mockRejectedValue(new Error('SecurityError'))
    setNavigator({ serviceWorker: { register } })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(registerServiceWorker()).resolves.toBeUndefined()

    expect(errSpy).toHaveBeenCalled()
  })

  it('is a no-op when the browser has no service worker support', async () => {
    setNavigator({})
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(registerServiceWorker()).resolves.toBeUndefined()

    expect(errSpy).not.toHaveBeenCalled()
  })
})
