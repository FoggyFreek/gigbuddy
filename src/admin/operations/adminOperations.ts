import { request } from '../../api/_client.ts'
import type { LimitedCollectionResponse } from '../../types/api.ts'

export interface OperationsSummary {
  terminalOperations: number
  retryingOperations: number
  pendingOperations: number
  oldestPendingAt: string | null
  unresolvedWebhookFailures: number
  statusDrift: number
}

export interface BillingOperationAlert {
  id: number
  userId: number
  subscriptionId: number | null
  userName: string | null
  userEmail: string
  opType: string
  status: string
  attemptCount: number
  lastErrorCode: string | null
  nextAttemptAt: string
  createdAt: string
  updatedAt: string
}

export interface WebhookFailureAlert {
  id: number
  subscriptionId: number | null
  userName: string | null
  userEmail: string | null
  providerPaymentId: string
  errorCode: string | null
  receivedAt: string
}

export interface StatusDriftAlert {
  subscriptionId: number
  userName: string | null
  userEmail: string
  subscriptionStatus: string
  scheduleStale: boolean
  repairNeeded: boolean
  paymentId: string | null
  paymentStatus: string | null
  paymentUpdatedAt: string | null
  stalePayment: boolean
}

const api = <T>(path: string) => request<T>(`/api/admin/operations${path}`)

export const getOperationsSummary = () => api<OperationsSummary>('/summary')

export const listBillingOperationAlerts = (limit = 100) =>
  api<LimitedCollectionResponse<BillingOperationAlert>>(`/billing-operations?limit=${limit}`)

export const listWebhookFailureAlerts = (limit = 100) =>
  api<LimitedCollectionResponse<WebhookFailureAlert>>(`/webhook-failures?limit=${limit}`)

export const listStatusDriftAlerts = (limit = 100) =>
  api<LimitedCollectionResponse<StatusDriftAlert>>(`/status-drift?limit=${limit}`)
