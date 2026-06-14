import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import useDebouncedSave from '../hooks/useDebouncedSave.ts'

describe('useDebouncedSave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts as idle', () => {
    const { result } = renderHook(() => useDebouncedSave(vi.fn(), 300))
    expect(result.current.status).toBe('idle')
  })

  it('sets status to saved after debounce fires', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useDebouncedSave(saveFn, 300))

    act(() => { result.current.schedule({ notes: 'hello' }) })
    expect(result.current.status).toBe('idle')

    await act(async () => { await vi.runAllTimersAsync() })
    expect(result.current.status).toBe('saved')
    expect(saveFn).toHaveBeenCalledWith({ notes: 'hello' })
  })

  it('debounces — only calls saveFn once for rapid updates', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useDebouncedSave(saveFn, 300))

    act(() => {
      result.current.schedule({ notes: 'a' })
      result.current.schedule({ notes: 'ab' })
      result.current.schedule({ notes: 'abc' })
    })

    await act(async () => { await vi.runAllTimersAsync() })
    expect(result.current.status).toBe('saved')
    expect(saveFn).toHaveBeenCalledTimes(1)
    expect(saveFn).toHaveBeenCalledWith({ notes: 'abc' })
  })

  it('sets status to error when saveFn rejects', async () => {
    const saveFn = vi.fn().mockRejectedValue(new Error('Network error'))
    const { result } = renderHook(() => useDebouncedSave(saveFn, 300))

    act(() => { result.current.schedule({ notes: 'fail' }) })
    await act(async () => { await vi.runAllTimersAsync() })
    expect(result.current.status).toBe('error')
  })

  it('flush saves pending data immediately', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useDebouncedSave(saveFn, 600))

    act(() => { result.current.schedule({ notes: 'flush me' }) })
    await act(async () => { await result.current.flush() })
    expect(saveFn).toHaveBeenCalledWith({ notes: 'flush me' })
    expect(result.current.status).toBe('saved')
  })

  it('flush does nothing when there is no pending data', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useDebouncedSave(saveFn, 300))

    await act(async () => { await result.current.flush() })
    expect(saveFn).not.toHaveBeenCalled()
  })

  it('calls onSaved with the payload after a successful save', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined)
    const onSaved = vi.fn()
    const { result } = renderHook(() => useDebouncedSave(saveFn, 300, onSaved))

    act(() => { result.current.schedule({ name: 'Bob' }) })
    await act(async () => { await vi.runAllTimersAsync() })

    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(onSaved).toHaveBeenCalledWith({ name: 'Bob' })
  })

  it('calls onSaved with the merged patch when multiple fields are scheduled', async () => {
    const saveFn = vi.fn().mockResolvedValue(undefined)
    const onSaved = vi.fn()
    const { result } = renderHook(() => useDebouncedSave(saveFn, 300, onSaved))

    act(() => {
      result.current.schedule({ name: 'Bob' })
      result.current.schedule({ email: 'bob@test.com' })
    })
    await act(async () => { await vi.runAllTimersAsync() })

    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(onSaved).toHaveBeenCalledWith({ name: 'Bob', email: 'bob@test.com' })
  })

  it('does not call onSaved when saveFn rejects', async () => {
    const saveFn = vi.fn().mockRejectedValue(new Error('Network error'))
    const onSaved = vi.fn()
    const { result } = renderHook(() => useDebouncedSave(saveFn, 300, onSaved))

    act(() => { result.current.schedule({ name: 'Bob' }) })
    await act(async () => { await vi.runAllTimersAsync() })

    expect(result.current.status).toBe('error')
    expect(onSaved).not.toHaveBeenCalled()
  })
})
