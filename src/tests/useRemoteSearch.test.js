import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import useRemoteSearch from '../hooks/useRemoteSearch.ts'

describe('useRemoteSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('waits for three trimmed characters and debounces the search', async () => {
    const search = vi.fn().mockResolvedValue([{ id: 1 }])
    const { result } = renderHook(() => useRemoteSearch({ search }))

    act(() => result.current.onInputChange(null, ' ab ', 'input'))
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(search).not.toHaveBeenCalled()

    act(() => result.current.onInputChange(null, ' abc ', 'input'))
    expect(result.current.loading).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(249) })
    expect(search).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })

    expect(search).toHaveBeenCalledWith('abc')
    expect(result.current.options).toEqual([{ id: 1 }])
    expect(result.current.loading).toBe(false)
  })

  it('ignores a stale response from an earlier query', async () => {
    let resolveFirst
    let resolveSecond
    const search = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve }))
    const { result } = renderHook(() => useRemoteSearch({ search }))

    act(() => result.current.onInputChange(null, 'first', 'input'))
    await act(async () => { await vi.advanceTimersByTimeAsync(250) })
    act(() => result.current.onInputChange(null, 'second', 'input'))
    await act(async () => { await vi.advanceTimersByTimeAsync(250) })

    await act(async () => { resolveSecond([{ id: 2 }]); await Promise.resolve() })
    expect(result.current.options).toEqual([{ id: 2 }])
    await act(async () => { resolveFirst([{ id: 1 }]); await Promise.resolve() })
    expect(result.current.options).toEqual([{ id: 2 }])
  })

  it('treats reset text as display-only and clear as a search reset', async () => {
    const search = vi.fn().mockResolvedValue([{ id: 1 }])
    const { result } = renderHook(() => useRemoteSearch({ search }))

    act(() => result.current.onInputChange(null, 'query', 'input'))
    act(() => result.current.onInputChange(null, 'Selected option', 'reset'))
    expect(result.current.inputValue).toBe('Selected option')
    expect(result.current.query).toBe('query')

    await act(async () => { await vi.advanceTimersByTimeAsync(250) })
    expect(search).toHaveBeenCalledWith('query')

    act(() => result.current.onInputChange(null, '', 'clear'))
    expect(result.current.query).toBe('')
    expect(result.current.options).toEqual([])
    expect(result.current.loading).toBe(false)
  })

  it('supports an externally controlled input', () => {
    const onInputValueChange = vi.fn()
    const { result } = renderHook(() => useRemoteSearch({
      search: vi.fn().mockResolvedValue([]),
      inputValue: 'supplier',
      onInputValueChange,
    }))

    act(() => result.current.onInputChange(null, 'picked supplier', 'reset'))
    expect(onInputValueChange).not.toHaveBeenCalled()
    act(() => result.current.onInputChange(null, 'new supplier', 'input'))
    expect(onInputValueChange).toHaveBeenCalledWith('new supplier')
  })
})
