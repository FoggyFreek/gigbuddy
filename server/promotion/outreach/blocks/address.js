import { escapeHtml } from '../../../../shared/outreachMerge.js'

function address(lines) {
  return `<address>${lines.filter(Boolean).map((line) => escapeHtml(line)).join('<br>')}</address>`
}

export const renderBandAddress = ({ tenant = {} }) => address([
  tenant.address_street,
  [tenant.address_postal_code, tenant.address_city].filter(Boolean).join(' '),
  tenant.address_country,
])

export const renderVenueAddress = ({ venue = {} }) => address([
  venue.street_and_number,
  [venue.postal_code, venue.city].filter(Boolean).join(' '),
  venue.country,
])
