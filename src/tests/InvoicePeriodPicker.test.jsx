import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import InvoicePeriodPicker from '../components/InvoicePeriodPicker.jsx'
import { defaultPeriod, invoiceInPeriod, periodLabel } from '../utils/invoicePeriod.js'
import theme from '../theme.js'

// Fix "today" to 2026-06-08. Fake only Date so setTimeout/waitFor still work.
const FIXED_NOW = new Date('2026-06-08T12:00:00.000Z')

function wrap(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

// Invoices spread across two years with specific months/quarters covered.
// 2026: March (month 2, Q1) and June (month 5, Q2)
// 2025: September (month 8, Q3)
const INVOICES = [
  { id: 1, invoice_number: '2026-0001', status: 'paid', issue_date: '2026-03-15', payment_term_days: 14, customer_name: 'Alpha BV',  total_cents: 10000 },
  { id: 2, invoice_number: '2026-0002', status: 'paid', issue_date: '2026-06-15', payment_term_days: 14, customer_name: 'Beta Corp', total_cents: 20000 },
  { id: 3, invoice_number: '2025-0001', status: 'paid', issue_date: '2025-09-15', payment_term_days: 14, customer_name: 'Gamma Ltd', total_cents: 30000 },
]

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(FIXED_NOW)
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

// ─── pure utility tests ────────────────────────────────────────────────────

describe('periodLabel', () => {
  it('fiscal_year', () => {
    expect(periodLabel({ mode: 'fiscal_year', year: 2026 })).toBe('FY 2026')
  })

  it('quarter', () => {
    expect(periodLabel({ mode: 'quarter', year: 2026, quarter: 2 })).toBe('Q2 2026')
  })

  it('all_time', () => {
    expect(periodLabel({ mode: 'all_time' })).toBe('All Time')
  })

  it('month contains the year and month abbreviation', () => {
    const label = periodLabel({ mode: 'month', year: 2026, month: 2 }) // March
    expect(label).toContain('2026')
    // Month abbreviation is locale-dependent; just confirm it is not empty.
    expect(label.length).toBeGreaterThan(4)
  })

  it('custom shows formatted from–to dates', () => {
    const label = periodLabel({ mode: 'custom', from: '2026-06-01', to: '2026-06-30' })
    expect(label).toContain('2026')
    expect(label).toContain('–')
  })
})

describe('invoiceInPeriod', () => {
  const inv = { issue_date: '2026-06-15' }

  it('fiscal_year: matches same year', () => {
    expect(invoiceInPeriod(inv, { mode: 'fiscal_year', year: 2026 })).toBe(true)
  })

  it('fiscal_year: rejects different year', () => {
    expect(invoiceInPeriod(inv, { mode: 'fiscal_year', year: 2025 })).toBe(false)
  })

  it('month: matches year and month', () => {
    expect(invoiceInPeriod(inv, { mode: 'month', year: 2026, month: 5 })).toBe(true)
  })

  it('month: rejects wrong month', () => {
    expect(invoiceInPeriod(inv, { mode: 'month', year: 2026, month: 4 })).toBe(false)
  })

  it('quarter: matches correct quarter (Q2 = months 3-5)', () => {
    expect(invoiceInPeriod(inv, { mode: 'quarter', year: 2026, quarter: 2 })).toBe(true)
  })

  it('quarter: rejects wrong quarter', () => {
    expect(invoiceInPeriod(inv, { mode: 'quarter', year: 2026, quarter: 1 })).toBe(false)
  })

  it('all_time: always true for invoice with date', () => {
    expect(invoiceInPeriod(inv, { mode: 'all_time' })).toBe(true)
  })

  it('custom: matches date within range', () => {
    expect(invoiceInPeriod(inv, { mode: 'custom', from: '2026-06-01', to: '2026-06-30' })).toBe(true)
  })

  it('custom: rejects date outside range', () => {
    expect(invoiceInPeriod(inv, { mode: 'custom', from: '2026-07-01', to: '2026-07-31' })).toBe(false)
  })

  it('excludes invoices without issue_date regardless of mode', () => {
    expect(invoiceInPeriod({ issue_date: null }, { mode: 'all_time' })).toBe(false)
    expect(invoiceInPeriod({}, { mode: 'fiscal_year', year: 2026 })).toBe(false)
  })
})

describe('defaultPeriod', () => {
  it('returns current fiscal year when invoices include the current year', () => {
    const p = defaultPeriod([{ issue_date: '2026-03-01' }])
    expect(p).toEqual({ mode: 'fiscal_year', year: 2026 })
  })

  it('returns current fiscal year when there are no invoices', () => {
    const p = defaultPeriod([])
    expect(p).toEqual({ mode: 'fiscal_year', year: 2026 })
  })

  it('falls back to most recent year when no current-year invoices', () => {
    const p = defaultPeriod([
      { issue_date: '2025-03-01' },
      { issue_date: '2024-06-01' },
    ])
    expect(p).toEqual({ mode: 'fiscal_year', year: 2025 })
  })
})

// ─── component tests ───────────────────────────────────────────────────────

describe('InvoicePeriodPicker — button label', () => {
  it('shows FY label for fiscal_year mode', () => {
    wrap(
      <InvoicePeriodPicker
        invoices={INVOICES}
        value={{ mode: 'fiscal_year', year: 2026 }}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /FY 2026/ })).toBeInTheDocument()
  })

  it('shows quarter label', () => {
    wrap(
      <InvoicePeriodPicker
        invoices={INVOICES}
        value={{ mode: 'quarter', year: 2026, quarter: 1 }}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /Q1 2026/ })).toBeInTheDocument()
  })

  it('shows All Time label', () => {
    wrap(
      <InvoicePeriodPicker
        invoices={INVOICES}
        value={{ mode: 'all_time' }}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /All Time/ })).toBeInTheDocument()
  })
})

describe('InvoicePeriodPicker — fiscal year grid', () => {
  async function openPicker(onChange = vi.fn()) {
    const user = userEvent.setup()
    wrap(
      <InvoicePeriodPicker
        invoices={INVOICES}
        value={{ mode: 'fiscal_year', year: 2026 }}
        onChange={onChange}
      />,
    )
    await user.click(screen.getByRole('button', { name: /FY 2026/ }))
    return user
  }

  it('opens the popover and shows the decade navigator label', async () => {
    await openPicker()
    // viewDecade = floor(2026/10)*10 = 2020 → label "2020 – 2029"
    expect(screen.getByText('2020 – 2029')).toBeInTheDocument()
  })

  it('shows all 10 years in the current decade', async () => {
    await openPicker()
    for (let y = 2020; y <= 2029; y++) {
      expect(screen.getByRole('option', { name: String(y) })).toBeInTheDocument()
    }
  })

  it('marks years with invoices as enabled, others as disabled', async () => {
    await openPicker()
    expect(screen.getByRole('option', { name: '2026' })).toHaveAttribute('aria-disabled', 'false')
    expect(screen.getByRole('option', { name: '2025' })).toHaveAttribute('aria-disabled', 'false')
    expect(screen.getByRole('option', { name: '2022' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('marks the current value as selected', async () => {
    await openPicker()
    expect(screen.getByRole('option', { name: '2026' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('option', { name: '2025' })).toHaveAttribute('aria-selected', 'false')
  })

  it('clicking a year with data calls onChange with fiscal_year period and closes', async () => {
    const onChange = vi.fn()
    const user = await openPicker(onChange)

    await user.click(screen.getByRole('option', { name: '2025' }))

    expect(onChange).toHaveBeenCalledWith({ mode: 'fiscal_year', year: 2025 })
    await waitFor(() =>
      expect(screen.queryByText('2020 – 2029')).not.toBeInTheDocument(),
    )
  })

  it('clicking a year without data does NOT call onChange', async () => {
    const onChange = vi.fn()
    const user = await openPicker(onChange)

    await user.click(screen.getByRole('option', { name: '2022' }))

    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('InvoicePeriodPicker — navigator', () => {
  it('prev/next in fiscal_year mode changes the decade', async () => {
    const user = userEvent.setup()
    wrap(
      <InvoicePeriodPicker
        invoices={INVOICES}
        value={{ mode: 'fiscal_year', year: 2026 }}
        onChange={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: /FY 2026/ }))
    expect(screen.getByText('2020 – 2029')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'previous' }))
    expect(screen.getByText('2010 – 2019')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'next' }))
    expect(screen.getByText('2020 – 2029')).toBeInTheDocument()
  })

  it('prev/next in month mode changes the year', async () => {
    const user = userEvent.setup()
    wrap(
      <InvoicePeriodPicker
        invoices={INVOICES}
        value={{ mode: 'fiscal_year', year: 2026 }}
        onChange={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: /FY 2026/ }))
    await user.click(screen.getByRole('button', { name: 'Month' }))

    // Now in month mode, navigator shows the year
    expect(screen.getByText('2026')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'previous' }))
    expect(screen.getByText('2025')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'next' }))
    expect(screen.getByText('2026')).toBeInTheDocument()
  })
})

describe('InvoicePeriodPicker — month grid', () => {
  it('shows 12 month options; only months with invoices are enabled', async () => {
    const user = userEvent.setup()
    wrap(
      <InvoicePeriodPicker
        invoices={INVOICES}
        value={{ mode: 'fiscal_year', year: 2026 }}
        onChange={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: /FY 2026/ }))
    await user.click(screen.getByRole('button', { name: 'Month' }))

    // 12 month options rendered
    expect(screen.getAllByRole('option')).toHaveLength(12)

    // 2026 has March (index 2) and June (index 5); all others disabled
    expect(screen.getByRole('option', { name: 'Mar' })).toHaveAttribute('aria-disabled', 'false')
    expect(screen.getByRole('option', { name: 'Jun' })).toHaveAttribute('aria-disabled', 'false')
    expect(screen.getByRole('option', { name: 'Jan' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('clicking an enabled month calls onChange with month period', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    wrap(
      <InvoicePeriodPicker
        invoices={INVOICES}
        value={{ mode: 'fiscal_year', year: 2026 }}
        onChange={onChange}
      />,
    )
    await user.click(screen.getByRole('button', { name: /FY 2026/ }))
    await user.click(screen.getByRole('button', { name: 'Month' }))
    await user.click(screen.getByRole('option', { name: 'Mar' }))

    expect(onChange).toHaveBeenCalledWith({ mode: 'month', year: 2026, month: 2 })
  })
})

describe('InvoicePeriodPicker — quarter grid', () => {
  it('shows Q1–Q4; only quarters with invoices are enabled', async () => {
    const user = userEvent.setup()
    wrap(
      <InvoicePeriodPicker
        invoices={INVOICES}
        value={{ mode: 'fiscal_year', year: 2026 }}
        onChange={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: /FY 2026/ }))
    await user.click(screen.getByRole('button', { name: 'Quarter' }))

    expect(screen.getAllByRole('option')).toHaveLength(4)

    // 2026 has Q1 (March) and Q2 (June)
    expect(screen.getByRole('option', { name: 'Q1' })).toHaveAttribute('aria-disabled', 'false')
    expect(screen.getByRole('option', { name: 'Q2' })).toHaveAttribute('aria-disabled', 'false')
    expect(screen.getByRole('option', { name: 'Q3' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('option', { name: 'Q4' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('clicking an enabled quarter calls onChange with quarter period', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    wrap(
      <InvoicePeriodPicker
        invoices={INVOICES}
        value={{ mode: 'fiscal_year', year: 2026 }}
        onChange={onChange}
      />,
    )
    await user.click(screen.getByRole('button', { name: /FY 2026/ }))
    await user.click(screen.getByRole('button', { name: 'Quarter' }))
    await user.click(screen.getByRole('option', { name: 'Q2' }))

    expect(onChange).toHaveBeenCalledWith({ mode: 'quarter', year: 2026, quarter: 2 })
  })
})

describe('InvoicePeriodPicker — All Time tab', () => {
  it('clicking All Time immediately calls onChange and closes the popover', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    wrap(
      <InvoicePeriodPicker
        invoices={INVOICES}
        value={{ mode: 'fiscal_year', year: 2026 }}
        onChange={onChange}
      />,
    )
    await user.click(screen.getByRole('button', { name: /FY 2026/ }))
    await user.click(screen.getByRole('button', { name: 'All Time' }))

    expect(onChange).toHaveBeenCalledWith({ mode: 'all_time' })
    await waitFor(() =>
      expect(screen.queryByText('2020 – 2029')).not.toBeInTheDocument(),
    )
  })
})

describe('InvoicePeriodPicker — custom range', () => {
  async function openAndSwitchToCustom(onChange = vi.fn()) {
    const user = userEvent.setup()
    wrap(
      <InvoicePeriodPicker
        invoices={INVOICES}
        value={{ mode: 'fiscal_year', year: 2026 }}
        onChange={onChange}
      />,
    )
    await user.click(screen.getByRole('button', { name: /FY 2026/ }))
    return { user, onChange }
  }

  it('Apply button is disabled when dates are missing', async () => {
    await openAndSwitchToCustom()
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
  })

  it('entering both dates enables Apply and clicking it calls onChange', async () => {
    const { user, onChange } = await openAndSwitchToCustom(vi.fn())

    // type="date" inputs are not role="textbox" in jsdom — query by label.
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-06-01' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-06-30' } })

    const applyBtn = screen.getByRole('button', { name: 'Apply' })
    expect(applyBtn).toBeEnabled()

    await user.click(applyBtn)

    expect(onChange).toHaveBeenCalledWith({
      mode: 'custom',
      from: '2026-06-01',
      to: '2026-06-30',
    })
  })
})
