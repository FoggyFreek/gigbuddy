import { useCallback, useEffect, useState } from 'react'
import { listProducts, listMerchSales } from '../../api/merch.ts'
import type { Product, MerchSale } from '../../types/entities.ts'

interface UseMerchStateResult {
  products: Product[] | null
  sales: MerchSale[] | null
  error: string | null
  setError: (msg: string | null) => void
  reload: () => Promise<void>
}

// Loads products + sales together; `reload` refreshes both after any mutation
// (every merch action affects stock, so both lists go stale at once).
export function useMerchState(): UseMerchStateResult {
  const [products, setProducts] = useState<Product[] | null>(null)
  const [sales, setSales] = useState<MerchSale[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([listProducts(), listMerchSales()])
      setProducts(p)
      setSales(s)
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([listProducts(), listMerchSales()])
      .then(([p, s]) => {
        if (cancelled) return
        setProducts(p)
        setSales(s)
      })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
    return () => { cancelled = true }
  }, [])

  return { products, sales, error, setError, reload }
}
