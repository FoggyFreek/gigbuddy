import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { listAccounts } from '../../../finance/accounts/accounts.ts'
import { fetchShopifyOrders, importShopifyOrders } from '../merch.ts'
import { useAccountingProfile } from '../../../contexts/accountingProfileContext.ts'
import type {
  Account,
  Product,
  ShopifyImportBody,
  ShopifyImportResult,
  ShopifyLineItem,
  ShopifyLineMapping,
  ShopifyOrder,
} from '../../../types/entities.ts'
import { commonVatSelection, taxCategoryUsesZeroRate } from '../../../../shared/taxCategories.js'

export type ShopifyImportStep = 'select' | 'map' | 'importing' | 'done'

export interface TaxSelectionPatch {
  tax_category_code: string | null
  tax_jurisdiction_code: string
}

export function lineMappable(line: ShopifyLineItem): boolean {
  return !line.skip_reason && !line.already_imported
}

function revenueMapping(
  account: Account | undefined,
  vatRate: number,
  country: string,
): ShopifyLineMapping | undefined {
  if (!account?.code) return undefined
  const selection = commonVatSelection(country, vatRate)
  return {
    type: 'revenue',
    account_code: account.code,
    vat_rate: vatRate,
    tax_category_code: selection?.tax_category_code ?? null,
    tax_jurisdiction_code: selection?.tax_jurisdiction_code ?? country,
  }
}

function defaultLineMapping(
  line: ShopifyLineItem,
  products: Product[],
): ShopifyLineMapping | undefined {
  const match = products.find(
    (product) => !product.archived_at && product.name?.toLowerCase() === line.title.toLowerCase(),
  )
  return match?.id != null ? { type: 'product', product_id: match.id } : undefined
}

export function createInitialMappings(
  current: Record<string, ShopifyLineMapping>,
  orders: ShopifyOrder[],
  products: Product[],
  revenueAccounts: Account[],
  defaultVatRate: number,
  accountingCountry: string,
): Record<string, ShopifyLineMapping> {
  const mappings = { ...current }
  for (const order of orders) {
    for (const line of order.line_items) {
      if (!lineMappable(line) || mappings[line.id]) continue
      const mapping = defaultLineMapping(line, products)
      if (mapping) mappings[line.id] = mapping
    }
    for (const extra of order.extra_components ?? []) {
      if (mappings[extra.key]) continue
      const mapping = revenueMapping(revenueAccounts[0], defaultVatRate, accountingCountry)
      if (mapping) mappings[extra.key] = mapping
    }
  }
  return mappings
}

export function mappingValue(mapping: ShopifyLineMapping | undefined): string {
  if (!mapping || mapping.type === 'skip') return 'skip'
  if (mapping.type === 'product') return `product:${mapping.product_id}`
  return `revenue:${mapping.account_code}`
}

export function mappingFromSelection(
  value: string,
  existing: ShopifyLineMapping | undefined,
  defaultVatRate: number,
  accountingCountry: string,
): ShopifyLineMapping {
  if (value === 'skip') return { type: 'skip' }
  if (value.startsWith('product:')) {
    return { type: 'product', product_id: Number(value.slice('product:'.length)) }
  }

  const vatRate = existing?.type === 'revenue' ? existing.vat_rate : defaultVatRate
  const selection = commonVatSelection(accountingCountry, vatRate)
  return {
    type: 'revenue',
    account_code: value.slice('revenue:'.length),
    vat_rate: vatRate,
    tax_category_code: existing?.type === 'revenue'
      ? existing.tax_category_code
      : (selection?.tax_category_code ?? null),
    tax_jurisdiction_code: existing?.type === 'revenue'
      ? existing.tax_jurisdiction_code
      : (selection?.tax_jurisdiction_code ?? accountingCountry),
  }
}

export function buildImportableOrders(
  orders: ShopifyOrder[],
  mappings: Record<string, ShopifyLineMapping>,
): ShopifyImportBody['orders'] {
  const importable: ShopifyImportBody['orders'] = []
  for (const order of orders) {
    const lines: ShopifyImportBody['orders'][number]['lines'] = []
    let complete = true
    for (const line of order.line_items.filter(lineMappable)) {
      const mapping = mappings[line.id]
      if (!mapping || mapping.type === 'skip') {
        complete = false
        break
      }
      lines.push({ shopify_line_id: line.id, mapping })
    }
    if (!complete) continue

    const extraComponents: NonNullable<ShopifyImportBody['orders'][number]['extra_components']> = []
    for (const extra of order.extra_components ?? []) {
      const mapping = mappings[extra.key]
      if (!mapping || mapping.type !== 'revenue') {
        complete = false
        break
      }
      extraComponents.push({ component_key: extra.key, mapping })
    }
    if (!complete) continue

    importable.push({
      shopify_order_id: order.id,
      lines,
      ...(extraComponents.length ? { extra_components: extraComponents } : {}),
    })
  }
  return importable
}

interface ShopifyApiError {
  body?: { error?: string; code?: string; message?: string }
}

export function useShopifyImportDialog(products: Product[]) {
  const { t } = useTranslation('merch')
  const { accountingCountry, defaultVatRate } = useAccountingProfile()
  const [step, setStep] = useState<ShopifyImportStep>('select')
  const [orders, setOrders] = useState<ShopifyOrder[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notConfigured, setNotConfigured] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [revenueAccounts, setRevenueAccounts] = useState<Account[]>([])
  const [mappings, setMappings] = useState<Record<string, ShopifyLineMapping>>({})
  const [result, setResult] = useState<ShopifyImportResult | null>(null)

  function shopifyErrorMessage(err: unknown, fallback: string): string {
    const body = (err as ShopifyApiError).body
    switch (body?.code) {
      case 'app_not_installed':
        return t($ => $.shopify.errors.appNotInstalled)
      case 'invalid_client':
        return t($ => $.shopify.errors.invalidClient)
      default:
        break
    }
    if (body?.message) return body.message
    if (body?.error === 'shopify_rate_limited') return t($ => $.shopify.errors.rateLimited)
    return err instanceof Error && err.message ? err.message : fallback
  }

  useEffect(() => {
    let active = true
    Promise.all([fetchShopifyOrders({}), listAccounts()])
      .then(([page, accounts]) => {
        if (!active) return
        setOrders(page.orders)
        setNextCursor(page.nextCursor)
        setRevenueAccounts(accounts.filter((account) => account.type === 'revenue' && account.is_active !== false))
      })
      .catch((err: unknown) => {
        if (!active) return
        if ((err as ShopifyApiError).body?.error === 'shopify_not_configured') setNotConfigured(true)
        else setError(shopifyErrorMessage(err, t($ => $.shopify.errors.loadOrders)))
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const selectedOrders = orders.filter((order) => selected.has(order.id))
  const importableOrders = buildImportableOrders(selectedOrders, mappings)

  async function loadMore(): Promise<void> {
    if (!nextCursor) return
    setLoadingMore(true)
    try {
      const page = await fetchShopifyOrders({ cursor: nextCursor })
      setOrders((current) => [...current, ...page.orders])
      setNextCursor(page.nextCursor)
    } catch (err: unknown) {
      setError(shopifyErrorMessage(err, t($ => $.shopify.errors.loadMoreOrders)))
    } finally {
      setLoadingMore(false)
    }
  }

  function toggleOrder(orderId: string): void {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(orderId)) next.delete(orderId)
      else next.add(orderId)
      return next
    })
  }

  function goToMap(): void {
    setMappings((current) => createInitialMappings(
      current,
      selectedOrders,
      products,
      revenueAccounts,
      defaultVatRate,
      accountingCountry,
    ))
    setStep('map')
  }

  function setLineMapping(lineId: string, mapping: ShopifyLineMapping): void {
    setMappings((current) => ({ ...current, [lineId]: mapping }))
  }

  function selectLineMapping(line: ShopifyLineItem, value: string): void {
    setLineMapping(
      line.id,
      mappingFromSelection(value, mappings[line.id], defaultVatRate, accountingCountry),
    )
  }

  function changeVat(
    lineId: string,
    mapping: Extract<ShopifyLineMapping, { type: 'revenue' }>,
    vatRate: number,
  ): void {
    setLineMapping(lineId, { ...mapping, vat_rate: vatRate })
  }

  function changeTax(
    lineId: string,
    mapping: Extract<ShopifyLineMapping, { type: 'revenue' }>,
    patch: TaxSelectionPatch,
  ): void {
    setLineMapping(lineId, {
      ...mapping,
      ...patch,
      ...(patch.tax_category_code && taxCategoryUsesZeroRate(patch.tax_category_code, 'sale')
        ? { vat_rate: 0 }
        : {}),
    })
  }

  async function runImport(): Promise<void> {
    setStep('importing')
    setError(null)
    try {
      setResult(await importShopifyOrders({ orders: importableOrders }))
      setStep('done')
    } catch (err: unknown) {
      setError(shopifyErrorMessage(err, t($ => $.shopify.errors.importFailed)))
      setStep('map')
    }
  }

  return {
    step,
    orders,
    nextCursor,
    loading,
    loadingMore,
    error,
    notConfigured,
    selected,
    revenueAccounts,
    mappings,
    result,
    selectedOrders,
    importableOrders,
    loadMore,
    toggleOrder,
    goToMap,
    goToSelect: () => setStep('select'),
    selectLineMapping,
    changeVat,
    changeTax,
    runImport,
  }
}
