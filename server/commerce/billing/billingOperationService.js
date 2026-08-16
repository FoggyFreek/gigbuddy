import { isDeepStrictEqual } from 'node:util'
import { getPaymentProvider } from './paymentProvider/providerFactory.js'
import { ProviderError } from './paymentProvider/ProviderError.js'
import { PAYMENT_STATUS } from './paymentProvider/statuses.js'
import {
  beginOperationAttempt,
  fetchOperationById,
  listRecoverableOperations,
  markOperationCompleted,
  markOperationFailed,
  markOperationSucceeded,
} from './billingOperationRepository.js'
import {
  setBillingRepairNeeded,
  setMandateLinkage,
  setPendingPaymentId,
  setScheduleStale,
  setUserMollieCustomerId,
} from './subscriptionRepository.js'
import { upsertPaymentOutcome } from './subscriptionPaymentRepository.js'
import { markRefundFailed, markRefundSucceeded } from './subscriptionRefundRepository.js'
import { rollbackPendingModuleChange } from './subscriptionModuleChangeRecovery.js'
import { logger } from '../../utils/logger.js'

const OPERATION_LEASE_MS = 2 * 60 * 1000

function retryDelayMs(attemptCount) {
  return Math.min(60 * 60 * 1000, 30 * 1000 * (2 ** Math.max(0, attemptCount - 1)))
}

function validateCommand(command) {
  if (command?.version !== 1 || typeof command.method !== 'string' || !command.args
      || typeof command.completion?.kind !== 'string') {
    throw new ProviderError('Stored billing operation command is invalid', {
      code: 'invalid_operation_command', retryable: false,
    })
  }
}

export function assertOperationCommand(operation, command) {
  validateCommand(command)
  if (operation.command_payload && !isDeepStrictEqual(operation.command_payload, command)) {
    throw new ProviderError('Billing operation idempotency key was reused with another command', {
      code: 'operation_command_conflict', retryable: false,
    })
  }
}

async function callProvider(command, idempotencyKey) {
  const provider = getPaymentProvider()
  const args = { ...command.args, idempotencyKey }
  if (command.method === 'createSchedule' && args.startAt) args.startAt = new Date(args.startAt)
  switch (command.method) {
    case 'createCustomer': {
      const customer = await provider.createCustomer(args)
      return { resourceId: customer.id }
    }
    case 'createCheckoutPayment': {
      const payment = await provider.createCheckoutPayment(args)
      return {
        resourceId: payment.id,
        checkoutUrl: payment.checkoutUrl,
        status: payment.status,
        createdAt: payment.createdAt?.toISOString?.() ?? payment.createdAt ?? null,
      }
    }
    case 'createRecurringPayment': {
      const payment = await provider.createRecurringPayment(args)
      return {
        resourceId: payment.id,
        status: payment.status,
        createdAt: payment.createdAt?.toISOString?.() ?? payment.createdAt ?? null,
      }
    }
    case 'createSchedule': {
      const schedule = await provider.createSchedule(args)
      return { resourceId: schedule.id, status: schedule.status }
    }
    case 'cancelSchedule':
      await provider.cancelSchedule(args)
      return { resourceId: args.scheduleId }
    case 'createRefund': {
      const refund = await provider.createRefund(args)
      return { resourceId: refund.id, status: refund.status }
    }
    default:
      throw new ProviderError('Stored billing operation method is not supported', {
        code: 'unsupported_operation_command', retryable: false,
      })
  }
}

async function completeSuccessfulOperation(db, operation) {
  const completion = operation.command_payload.completion
  const result = operation.result_payload ?? { resourceId: operation.mollie_resource_id }
  switch (completion.kind) {
    case 'none':
    case 'cancelSchedule':
      break
    case 'linkCustomer':
      await setUserMollieCustomerId(db, completion.userId, result.resourceId)
      break
    case 'linkFirstPayment':
      await setMandateLinkage(db, completion.subscriptionId, { firstPaymentId: result.resourceId })
      await upsertPaymentOutcome(db, {
        subscriptionId: completion.subscriptionId,
        molliePaymentId: result.resourceId,
        kind: completion.paymentKind,
        amountCents: completion.amountCents,
        status: result.status ?? PAYMENT_STATUS.OPEN,
        mollieCreatedAt: result.createdAt ? new Date(result.createdAt) : new Date(),
        priceSnapshot: completion.priceSnapshot ?? null,
      })
      break
    case 'linkModulePayment':
      await setPendingPaymentId(db, completion.subscriptionId, result.resourceId)
      await upsertPaymentOutcome(db, {
        subscriptionId: completion.subscriptionId,
        molliePaymentId: result.resourceId,
        kind: 'proration',
        amountCents: completion.amountCents,
        status: result.status ?? PAYMENT_STATUS.OPEN,
        mollieCreatedAt: result.createdAt ? new Date(result.createdAt) : new Date(),
      })
      break
    case 'linkSchedule':
      await setMandateLinkage(db, completion.subscriptionId, { subscriptionId: result.resourceId })
      await setScheduleStale(db, completion.subscriptionId, false)
      await setBillingRepairNeeded(db, completion.subscriptionId, false)
      break
    case 'completeRefund':
      await markRefundSucceeded(db, completion.refundId, result.resourceId)
      break
    default:
      throw new ProviderError('Stored billing operation completion is not supported', {
        code: 'unsupported_operation_completion', retryable: false,
      })
  }
  return markOperationCompleted(db, operation.id)
}

async function completeTerminalOperation(db, operation) {
  const completion = operation.command_payload.completion
  if (completion.kind === 'completeRefund') await markRefundFailed(db, completion.refundId)
  if (completion.kind === 'linkModulePayment') {
    await rollbackPendingModuleChange(db, completion.subscriptionId)
  }
  if (completion.kind === 'linkSchedule') {
    await setBillingRepairNeeded(db, completion.subscriptionId, true)
  }
  if (completion.kind === 'cancelSchedule') {
    await setBillingRepairNeeded(db, completion.subscriptionId, true)
  }
  await markOperationCompleted(db, operation.id)
}

export async function executeBillingOperation(db, operation) {
  validateCommand(operation.command_payload)
  if (operation.status === 'succeeded') {
    if (!operation.completed_at) await completeSuccessfulOperation(db, operation)
    return { skipped: true, resourceId: operation.mollie_resource_id, result: operation.result_payload }
  }
  if (operation.status === 'failed_terminal') {
    if (!operation.completed_at) await completeTerminalOperation(db, operation)
    throw new ProviderError('Billing operation was rejected by the provider', {
      code: operation.last_error_code ?? 'provider_error', retryable: false,
    })
  }

  const claimed = await beginOperationAttempt(db, operation.id, OPERATION_LEASE_MS)
  if (!claimed) {
    const current = await fetchOperationById(db, operation.id)
    if (current?.status === 'succeeded') return executeBillingOperation(db, current)
    throw new ProviderError('Billing operation is already in progress', {
      code: 'operation_in_progress', retryable: true,
    })
  }

  let result
  try {
    result = await callProvider(claimed.command_payload, claimed.idempotency_key)
  } catch (err) {
    const retryable = err instanceof ProviderError ? err.retryable : true
    const code = err instanceof ProviderError ? err.code : 'unknown'
    const failed = await markOperationFailed(db, claimed.id, {
      status: retryable ? 'failed_retryable' : 'failed_terminal',
      lastErrorCode: code,
      retryAfterMs: retryable ? retryDelayMs(claimed.attempt_count) : 0,
    })
    if (!retryable) await completeTerminalOperation(db, failed)
    throw err
  }
  const succeeded = await markOperationSucceeded(db, claimed.id, {
    mollieResourceId: result.resourceId, resultPayload: result,
  })
  await completeSuccessfulOperation(db, succeeded)
  return { skipped: false, resourceId: result.resourceId, result }
}

export async function recoverBillingOperations(db, limit = 100) {
  const operations = await listRecoverableOperations(db, limit)
  for (const operation of operations) {
    const attemptCount = operation.attempt_count
      + (['pending', 'failed_retryable'].includes(operation.status) ? 1 : 0)
    await executeBillingOperation(db, operation).then(() => {
      logger.info('billing.operation_recovered', {
        operationId: operation.id,
        subscriptionId: operation.subscription_id,
        opType: operation.op_type,
        attemptCount,
      })
    }).catch((err) => {
      logger.error('billing.operation_recovery_failed', {
        err,
        operationId: operation.id,
        subscriptionId: operation.subscription_id,
        opType: operation.op_type,
        attemptCount,
      })
    })
  }
  return operations.length
}
