import { useCallback, useEffect, useState } from 'react'
import { listProducts, listMerchSales } from '../../api/merch.js'

// Loads products + sales together; `reload` refreshes both after any mutation
// (every merch action affects stock, so both lists go stale at once).
export function useMerchState() {
  const [products, setProducts] = useState(null)
  const [sales, setSales] = useState(null)
  const [error, setError] = useState(null)

  const reload = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([listProducts(), listMerchSales()])
      setProducts(p)
      setSales(s)
      setError(null)
    } catch (e) {
      setError(e.message)
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
      .catch((e) => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [])

  return { products, sales, error, setError, reload }
}
