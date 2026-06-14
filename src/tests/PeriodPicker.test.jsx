import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PeriodPicker from '../components/shared/periodPicker.tsx'
import {
  defaultPeriod,
  defaultPeriodForDates,
  invoiceInPeriod,
  periodLabel,
  periodQueryString,
} from '../utils/invoicePeriod.ts'
import theme from '../theme.ts'

const FIXED_NOW = new Date('2026-06-08T12:00:00.000Z')
const AVAILABLE_DATES = ['2026-03-15', '2026-06-15', '2025-09-15']

function wrap(ui) {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(FIXED_NOW)
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('period utilities', () => {
  it('formats labels', () => {
    expect(periodLabel({ mode: 'fiscal_year', year: 2026 })).toBe('FY 2026')
    expect(periodLabel({ mode: 'quarter', year: 2026, quarter: 2 })).toBe('Q2 2026')
    expect(periodLabel({ mode: 'all_time' })).toBe('All Time')
    expect(periodLabel({ mode: 'custom', from: '2026-06-01', to: '2026-06-30' })).toContain(' - ')
  })

  it('matches records to periods', () => {
    const inv = { issue_date: '2026-06-15' }

    expect(invoiceInPeriod(inv, { mode: 'fiscal_year', year: 2026 })).toBe(true)
    expect(invoiceInPeriod(inv, { mode: 'month', year: 2026, month: 5 })).toBe(true)
    expect(invoiceInPeriod(inv, { mode: 'quarter', year: 2026, quarter: 2 })).toBe(true)
    expect(invoiceInPeriod(inv, { mode: 'custom', from: '2026-06-01', to: '2026-06-30' })).toBe(true)
    expect(invoiceInPeriod(inv, { mode: 'month', year: 2026, month: 4 })).toBe(false)
    expect(invoiceInPeriod({ issue_date: null }, { mode: 'all_time' })).toBe(false)
  })

  it('builds query strings for server-side period loading', () => {
    expect(periodQueryString({ mode: 'fiscal_year', year: 2026 })).toBe('?mode=fiscal_year&year=2026')
    expect(periodQueryString({ mode: 'month', year: 2026, month: 5 })).toBe('?mode=month&year=2026&month=5')
    expect(periodQueryString({ mode: 'all_time' })).toBe('?mode=all_time')
  })

  it('defaults to current year or the most recent year with data', () => {
    expect(defaultPeriod([{ issue_date: '2026-03-01' }])).toEqual({ mode: 'fiscal_year', year: 2026 })
    expect(defaultPeriod([])).toEqual({ mode: 'fiscal_year', year: 2026 })
    expect(defaultPeriodForDates(['2025-03-01', '2024-06-01'])).toEqual({ mode: 'fiscal_year', year: 2025 })
  })
})

describe('PeriodPicker button label', () => {
  it('shows the selected period label', () => {
    wrap(
      <PeriodPicker
        availableDates={AVAILABLE_DATES}
        value={{ mode: 'fiscal_year', year: 2026 }}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: /FY 2026/ })).toBeInTheDocument()
  })
})

describe('PeriodPicker fiscal year grid', () => {
  async function openPicker(onChange = vi.fn()) {
    const user = userEvent.setup()
    wrap(
      <PeriodPicker
        availableDates={AVAILABLE_DATES}
        value={{ mode: 'fiscal_year', year: 2026 }}
        onChange={onChange}
      />,
    )
    await user.click(screen.getByRole('button', { name: /FY 2026/ }))
    return user
  }

  it('shows the decade and enables only years with data', async () => {
    await openPicker()

    expect(screen.getByText('2020 - 2029')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '2026' })).toHaveAttribute('aria-disabled', 'false')
    expect(screen.getByRole('option', { name: '2025' })).toHaveAttribute('aria-disabled', 'false')
    expect(screen.getByRole('option', { name: '2022' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('selects a year with data and ignores a year without data', async () => {
    const onChange = vi.fn()
    const user = await openPicker(onChange)

    await user.click(screen.getByRole('option', { name: '2022' }))
    expect(onChange).not.toHaveBeenCalled()

    await user.click(screen.getByRole('option', { name: '2025' }))
    expect(onChange).toHaveBeenCalledWith({ mode: 'fiscal_year', year: 2025 })
    await waitFor(() => expect(screen.queryByText('2020 - 2029')).not.toBeInTheDocument())
  })
})

describe('PeriodPicker navigator', () => {
  it('changes decade for fiscal years and year for months', async () => {
    const user = userEvent.setup()
    wrap(
      <PeriodPicker
        availableDates={AVAILABLE_DATES}
        value={{ mode: 'fiscal_year', year: 2026 }}
        onChange={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: /FY 2026/ }))

    await user.click(screen.getByRole('button', { name: 'previous' }))
    expect(screen.getByText('2010 - 2019')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'next' }))
    await user.click(screen.getByRole('button', { name: 'Month' }))
    await user.click(screen.getByRole('button', { name: 'previous' }))
    expect(screen.getByText('2025')).toBeInTheDocument()
  })
})

describe('PeriodPicker month and quarter grids', () => {
  it('enables only months and quarters represented by available dates', async () => {
    const user = userEvent.setup()
    wrap(
      <PeriodPicker
        availableDates={AVAILABLE_DATES}
        value={{ mode: 'fiscal_year', year: 2026 }}
        onChange={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: /FY 2026/ }))

    await user.click(screen.getByRole('button', { name: 'Month' }))
    expect(screen.getByRole('option', { name: 'Mar' })).toHaveAttribute('aria-disabled', 'false')
    expect(screen.getByRole('option', { name: 'Jun' })).toHaveAttribute('aria-disabled', 'false')
    expect(screen.getByRole('option', { name: 'Jan' })).toHaveAttribute('aria-disabled', 'true')

    await user.click(screen.getByRole('button', { name: 'Quarter' }))
    expect(screen.getByRole('option', { name: 'Q1' })).toHaveAttribute('aria-disabled', 'false')
    expect(screen.getByRole('option', { name: 'Q2' })).toHaveAttribute('aria-disabled', 'false')
    expect(screen.getByRole('option', { name: 'Q3' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('selects month and quarter periods', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    wrap(
      <PeriodPicker
        availableDates={AVAILABLE_DATES}
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

describe('PeriodPicker all time and custom range', () => {
  it('selects all time immediately', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    wrap(
      <PeriodPicker
        availableDates={AVAILABLE_DATES}
        value={{ mode: 'fiscal_year', year: 2026 }}
        onChange={onChange}
      />,
    )
    await user.click(screen.getByRole('button', { name: /FY 2026/ }))
    await user.click(screen.getByRole('button', { name: 'All Time' }))

    expect(onChange).toHaveBeenCalledWith({ mode: 'all_time' })
  })

  it('applies a custom range', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    wrap(
      <PeriodPicker
        availableDates={AVAILABLE_DATES}
        value={{ mode: 'fiscal_year', year: 2026 }}
        onChange={onChange}
      />,
    )
    await user.click(screen.getByRole('button', { name: /FY 2026/ }))

    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'open from picker' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'open to picker' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-06-01' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-06-30' } })
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(onChange).toHaveBeenCalledWith({
      mode: 'custom',
      from: '2026-06-01',
      to: '2026-06-30',
    })
  })
})
