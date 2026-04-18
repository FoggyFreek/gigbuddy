import { useCallback, useEffect, useRef, useState } from 'react'

export default function useDebouncedSave(saveFn, delay = 600) {
  const [status, setStatus] = useState('idle') // 'idle' | 'saving' | 'saved' | 'error'
  const timerRef = useRef(null)
  const pendingRef = useRef(null)

  const runSave = useCallback(async () => {
    if (pendingRef.current === null) return
    const payload = pendingRef.current
    pendingRef.current = null
    setStatus('saving')
    try {
      await saveFn(payload)
      setStatus('saved')
    } catch {
      setStatus('error')
    }
  }, [saveFn])

  const schedule = useCallback((data) => {
    pendingRef.current = { ...pendingRef.current, ...data }
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

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return { schedule, flush, status }
}
