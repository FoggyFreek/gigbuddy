import { renderBandAddress, renderVenueAddress } from './address.js'
import { renderInvoicePaymentBlock, renderMessageBlock } from './invoicePayment.js'

export const BLOCK_RENDERERS = Object.freeze({
  'band.address': renderBandAddress,
  'venue.address': renderVenueAddress,
  'invoice.payment_block': renderInvoicePaymentBlock,
  message: renderMessageBlock,
})

export function renderOutreachBlocks(keys, context, { onUnknown } = {}) {
  return Object.fromEntries(keys.map((key) => {
    const renderer = BLOCK_RENDERERS[key]
    if (!renderer) {
      onUnknown?.(key)
      return [key, '']
    }
    return [key, renderer(context)]
  }))
}
