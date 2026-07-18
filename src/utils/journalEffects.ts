import { computePurchaseLineTotals } from './purchaseTotals.ts'
import type { Account, AccountingSettings } from '../types/entities.ts'
import type { JournalForm } from '../components/journal/journalFormHelpers.ts'

export interface JournalAccountEffect {
  code: string
  name: string | null
  amountCents: number
}

export interface JournalEffects {
  debit: JournalAccountEffect[]
  credit: JournalAccountEffect[]
  totalDebitCents: number
  totalCreditCents: number
  differenceCents: number
}

// Previews what approving the given journal drafts would post to the ledger,
// mirroring the server's postUserJournal: each line's gross amount splits into
// net (line account) + VAT (input/output VAT account on the same side), and a
// balancing account takes the gross on the opposite side. Accounts are netted
// (debits − credits) and land in the debit or credit column by the net's sign;
// accounts that cancel out are dropped.
export function computeJournalEffects(
  forms: Iterable<JournalForm>,
  accounts: Account[],
  settings: AccountingSettings | null,
): JournalEffects {
  const totals = new Map<string, number>() // code → debits − credits, cents
  const post = (code: string, side: 'debit' | 'credit', cents: number) => {
    totals.set(code, (totals.get(code) ?? 0) + (side === 'debit' ? cents : -cents))
  }

  for (const form of forms) {
    for (const line of form.lines) {
      const code = line.account_code?.trim()
      const amount = Math.round(Number(line.amount_cents) || 0)
      if (!code || !line.side || amount <= 0) continue
      const { netCents, vatCents } = computePurchaseLineTotals({
        amount_incl_cents: amount, tax_rate: line.vat_rate,
      })
      post(code, line.side, netCents)
      if (vatCents > 0) {
        const vatCode = line.side === 'debit'
          ? settings?.input_vat_account_code
          : settings?.output_vat_account_code
        // Without configured VAT accounts the VAT part stays on the line account
        // so the preview still balances.
        post(vatCode || code, line.side, vatCents)
      }
      const balancing = line.balancing_account_code?.trim()
      if (balancing) post(balancing, line.side === 'debit' ? 'credit' : 'debit', amount)
    }
  }

  const nameByCode = new Map(accounts.filter((a) => a.code).map((a) => [a.code, a.name ?? null]))
  const debit: JournalAccountEffect[] = []
  const credit: JournalAccountEffect[] = []
  for (const [code, net] of totals) {
    if (net === 0) continue
    const effect = { code, name: nameByCode.get(code) ?? null, amountCents: Math.abs(net) }
    if (net > 0) debit.push(effect)
    else credit.push(effect)
  }
  const byCode = (a: JournalAccountEffect, b: JournalAccountEffect) => a.code.localeCompare(b.code)
  debit.sort(byCode)
  credit.sort(byCode)

  const totalDebitCents = debit.reduce((sum, e) => sum + e.amountCents, 0)
  const totalCreditCents = credit.reduce((sum, e) => sum + e.amountCents, 0)
  return {
    debit,
    credit,
    totalDebitCents,
    totalCreditCents,
    differenceCents: totalDebitCents - totalCreditCents,
  }
}
