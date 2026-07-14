// Pure invoice-domain formatting shared across layers.
function pad4(value) {
  return String(value).padStart(4, '0')
}

export function formatInvoiceNumber(year, sequence) {
  return `${year}-${pad4(sequence)}`
}
