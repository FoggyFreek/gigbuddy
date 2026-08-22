// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_ACCOUNTS,
  seedTenantAccounting,
} from '../defaultChartOfAccounts.js'

function recordingClient() {
  return { query: vi.fn(async () => ({ rows: [] })) }
}

function seededAccounts(client) {
  return JSON.parse(client.query.mock.calls[0][1][1])
}

describe('default chart of accounts', () => {
  it('builds the complete localized chart and settings in two idempotent writes', async () => {
    const nlClient = recordingClient()
    await seedTenantAccounting(nlClient, 42, 'nl')

    expect(nlClient.query).toHaveBeenCalledTimes(2)
    const [[accountSql, accountParams], [settingsSql, settingsParams]] = nlClient.query.mock.calls
    expect(accountSql).toContain('jsonb_to_recordset')
    expect(accountSql).toContain('ON CONFLICT (tenant_id, code) DO NOTHING')
    expect(accountParams[0]).toBe(42)

    const accounts = seededAccounts(nlClient)
    expect(accounts).toHaveLength(57)
    expect(accounts.map(({ code }) => code)).toEqual(DEFAULT_ACCOUNTS.map(({ code }) => code))
    expect(new Set(accounts.map(({ code }) => code))).toHaveProperty('size', accounts.length)

    const byCode = Object.fromEntries(accounts.map((account) => [account.code, account]))
    expect(byCode['11200']).toMatchObject({
      name: 'Debiteuren',
      type: 'asset',
      parent_code: '11000',
      is_capitalizable: false,
      reporting_group: null,
    })
    expect(byCode['21100'].name).toBe('Crediteuren')
    expect(byCode['13000'].is_capitalizable).toBe(true)
    expect(byCode['14000'].is_capitalizable).toBe(true)
    expect(byCode['13100'].is_capitalizable).toBe(false)
    expect(byCode['11000'].is_capitalizable).toBe(false)
    expect(byCode['62100'].is_capitalizable).toBe(false)
    expect(byCode['70000'].reporting_group).toBe('other_operating_income')
    expect(byCode['71000']).toMatchObject({
      parent_code: '70000',
      reporting_group: 'other_operating_income',
    })
    for (const account of accounts) {
      if (account.parent_code !== null) expect(byCode).toHaveProperty(account.parent_code)
    }

    expect(settingsSql).toContain('ON CONFLICT (tenant_id) DO NOTHING')
    expect(settingsParams).toEqual([
      42,
      '11200', '41000', '21100', '22000', '62100', '11000', '11100',
      '24000', '15000', '15010', '24010', '64900', '12200', '42000',
      '51000', '11300', '11400', '64100',
    ])

    const fallbackClient = recordingClient()
    await seedTenantAccounting(fallbackClient, 43, 'de')
    expect(Object.fromEntries(seededAccounts(fallbackClient).map((account) => [account.code, account]))['11200'].name)
      .toBe('Accounts Receivable')

    const noCountryClient = recordingClient()
    await seedTenantAccounting(noCountryClient, 44)
    expect(Object.fromEntries(seededAccounts(noCountryClient).map((account) => [account.code, account]))['11200'].name)
      .toBe('Accounts Receivable')
  })
})
