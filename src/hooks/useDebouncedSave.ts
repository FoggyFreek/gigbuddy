import { useCallback, useEffect, useRef, useState } from 'react'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export interface DebouncedSaveResult<T extends Record<string, unknown>> {
  schedule: (data: Partial<T>) => void
  flush: () => Promise<void>
  /** Drops any pending save without persisting it (e.g. the field was cleared). */
  cancel: () => void
  status: SaveStatus
}

export default function useDebouncedSave<T extends Record<string, unknown>>(
  saveFn: (value: T) => Promise<unknown> | void,
  delay = 600,
  onSaved: ((value: T) => void) | null = null,
): DebouncedSaveResult<T> {
  const [status, setStatus] = useState<SaveStatus>('idle')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<T | null>(null)

  const runSave = useCallback(async () => {
    if (pendingRef.current === null) return
    const payload = pendingRef.current
    pendingRef.current = null
    setStatus('saving')
    try {
      await saveFn(payload)
      setStatus('saved')
      onSaved?.(payload)
    } catch {
      setStatus('error')
    }
  }, [saveFn, onSaved])

  const schedule = useCallback((data: Partial<T>) => {
    pendingRef.current = { ...pendingRef.current, ...data } as T
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      runSave()
    }, delay)
  }, [runSave, delay])

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    await runSave()
  }, [runSave])

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    pendingRef.current = null
  }, [])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return { schedule, flush, cancel, status }
}
