import { useCallback, useEffect, useState } from 'react'
import { listProducts, listMerchSales } from '../../api/merch.ts'
import { listAccounts, getAccountingSettings } from '../../api/accounts.ts'
import type { Product, MerchSale, Account } from '../../types/entities.ts'

interface UseMerchStateResult {
  products: Product[] | null
  sales: MerchSale[] | null
  // Revenue accounts a product may book to: the band's merch revenue account
  // plus all its hierarchical descendants (active only).
  revenueAccounts: Account[]
  error: string | null
  setError: (msg: string | null) => void
  reload: () => Promise<void>
}

// The merch revenue parent account plus every active descendant reachable via
// parent_code (DFS over a children map). Empty when no parent is configured.
function eligibleRevenueAccounts(accounts: Account[], parentCode?: string): Account[] {
  if (!parentCode) return []
  const childrenByParent = new Map<string, Account[]>()
  for (const a of accounts) {
    if (!a.parent_code) continue
    const siblings = childrenByParent.get(a.parent_code) ?? []
    siblings.push(a)
    childrenByParent.set(a.parent_code, siblings)
  }
  const parent = accounts.find((a) => a.code === parentCode)
  if (!parent) return []
  const out: Account[] = []
  const stack: Account[] = [parent]
  const seen = new Set<string>()
  while (stack.length) {
    const node = stack.pop()!
    if (!node.code || seen.has(node.code)) continue
    seen.add(node.code)
    if (node.is_active) out.push(node)
    stack.push(...(childrenByParent.get(node.code) ?? []))
  }
  return out.sort((a, b) => (a.code ?? '').localeCompare(b.code ?? ''))
}

// Loads products + sales together; `reload` refreshes both after any mutation
// (every merch action affects stock, so both lists go stale at once). Accounts
// and settings only feed the product dialog's revenue-account picker, so they
// are loaded once on mount and not part of `reload`.
export function useMerchState(): UseMerchStateResult {
  const [products, setProducts] = useState<Product[] | null>(null)
  const [sales, setSales] = useState<MerchSale[] | null>(null)
  const [revenueAccounts, setRevenueAccounts] = useState<Account[]>([])
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
    Promise.all([listProducts(), listMerchSales(), listAccounts(), getAccountingSettings()])
      .then(([p, s, accs, settings]) => {
        if (cancelled) return
        setProducts(p)
        setSales(s)
        setRevenueAccounts(eligibleRevenueAccounts(accs, settings.merch_revenue_account_code))
      })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
    return () => { cancelled = true }
  }, [])

  return { products, sales, revenueAccounts, error, setError, reload }
}
