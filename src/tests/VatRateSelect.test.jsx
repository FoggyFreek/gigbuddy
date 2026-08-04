import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import VatRateSelect from '../components/shared/VatRateSelect.tsx'
import TaxCategorySelect from '../components/shared/TaxCategorySelect.tsx'
import i18n from '../i18n/index.ts'

beforeEach(async () => {
  await i18n.changeLanguage('nl')
})

afterEach(async () => {
  await i18n.changeLanguage('en')
})

describe('Dutch VAT selector', () => {
  it('shows the three common rates with meaningful Dutch tax labels', async () => {
    const user = userEvent.setup()
    render(
      <VatRateSelect
        id="vat-rate"
        label="Btw-tarief"
        country="nl"
        value={21}
        categoryCode="domestic_standard"
        onChange={() => {}}
      />,
    )

    await user.click(screen.getByRole('combobox', { name: 'Btw-tarief' }))
    expect(screen.getByRole('option', { name: /21%.*algemeen btw-tarief/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /9%.*verlaagd btw-tarief/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /0%.*nultarief/i })).toBeInTheDocument()
  })

  it('inherits category and jurisdiction when a common rate is selected', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <VatRateSelect
        id="vat-rate"
        label="Btw-tarief"
        country="nl"
        value={21}
        categoryCode="domestic_standard"
        onChange={onChange}
      />,
    )

    await user.click(screen.getByRole('combobox', { name: 'Btw-tarief' }))
    await user.click(screen.getByRole('option', { name: /9%.*verlaagd btw-tarief/i }))
    expect(onChange).toHaveBeenCalledWith(9, {
      tax_category_code: 'domestic_reduced',
      tax_jurisdiction_code: 'nl',
    })
  })

  it('keeps no VAT distinct from the zero rate', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <VatRateSelect
        id="vat-rate"
        label="Btw-tarief"
        country="nl"
        value={null}
        categoryCode={null}
        noVatLabel="Geen btw"
        onChange={onChange}
      />,
    )

    await user.click(screen.getByRole('combobox', { name: 'Btw-tarief' }))
    expect(screen.getByRole('option', { name: 'Geen btw' })).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: /0%.*nultarief/i }))
    expect(onChange).toHaveBeenCalledWith(0, {
      tax_category_code: 'domestic_zero',
      tax_jurisdiction_code: 'nl',
    })
  })

  it('keeps detailed categories hidden until another treatment is requested', async () => {
    const user = userEvent.setup()
    render(
      <TaxCategorySelect
        direction="sale"
        categoryCode="domestic_standard"
        jurisdictionCode="nl"
        defaultJurisdiction="nl"
        rate={21}
        onChange={() => {}}
      />,
    )

    expect(screen.queryByRole('combobox', { name: 'Btw-categorie' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /anders/i }))
    expect(screen.getByRole('combobox', { name: 'Btw-categorie' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Belastingland' })).toBeInTheDocument()
  })
})
