import { AsyncLocalStorage } from 'node:async_hooks'

const als = new AsyncLocalStorage()

export function runWithStore(store, fn) {
  return als.run(store, fn)
}

export function getStore() {
  return als.getStore()
}

export function setContextField(key, value) {
  const store = als.getStore()
  if (store) store[key] = value
}
