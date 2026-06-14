import { request } from './_client.ts'
import type { Product, MerchSale, Id } from '../types/entities.ts'

const api = <T = unknown>(path: string, options?: RequestInit) =>
  request<T>(`/api/merch${path}`, options)

export const listProducts = () => api<Product[]>('/products')
export const createProduct = (body: Partial<Product>) =>
  api<Product>('/products', { method: 'POST', body: JSON.stringify(body) })
export const updateProduct = (id: Id, body: Partial<Product>) =>
  api<Product>(`/products/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
export const archiveProduct = (id: Id) => api<void>(`/products/${id}`, { method: 'DELETE' })

export const listMerchSales = () => api<MerchSale[]>('/sales')
export const recordMerchSale = (body: Partial<MerchSale>) =>
  api<MerchSale>('/sales', { method: 'POST', body: JSON.stringify(body) })
export const voidMerchSale = (id: Id) =>
  api<MerchSale>(`/sales/${id}/void`, { method: 'POST' })
