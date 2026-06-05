// Shared PropTypes shapes for common app entities, so components declare
// meaningful contracts (issue #56) without duplicating large prop blocks.
import PropTypes from 'prop-types'

export const idProp = PropTypes.oneOfType([PropTypes.number, PropTypes.string])

export const venueShape = PropTypes.shape({
  id: idProp,
  name: PropTypes.string,
  category: PropTypes.string,
  organization_name: PropTypes.string,
  city: PropTypes.string,
  region: PropTypes.string,
  postal_code: PropTypes.string,
  country: PropTypes.string,
  primary_contact_name: PropTypes.string,
  years: PropTypes.arrayOf(PropTypes.number),
  is_primary: PropTypes.bool,
})

export const gigShape = PropTypes.shape({
  id: idProp,
  event_date: PropTypes.oneOfType([PropTypes.string, PropTypes.instanceOf(Date)]),
  event_description: PropTypes.string,
  status: PropTypes.string,
  start_time: PropTypes.string,
  end_time: PropTypes.string,
  banner_path: PropTypes.string,
  venue: venueShape,
  festival: venueShape,
  open_task_count: PropTypes.number,
})

export const memberShape = PropTypes.shape({
  id: idProp,
  name: PropTypes.string,
  color: PropTypes.string,
  position: PropTypes.string,
  sort_order: PropTypes.number,
})

export const participantShape = PropTypes.shape({
  band_member_id: idProp,
  name: PropTypes.string,
  color: PropTypes.string,
  position: PropTypes.string,
  vote: PropTypes.string,
})

export const rehearsalShape = PropTypes.shape({
  id: idProp,
  proposed_date: PropTypes.string,
  status: PropTypes.string,
  location: PropTypes.string,
  participants: PropTypes.arrayOf(participantShape),
})

export const bandEventShape = PropTypes.shape({
  id: idProp,
  title: PropTypes.string,
  start_date: PropTypes.string,
  end_date: PropTypes.string,
  location: PropTypes.string,
})

export const slotShape = PropTypes.shape({
  id: idProp,
  band_member_id: idProp,
  start_date: PropTypes.string,
  end_date: PropTypes.string,
  status: PropTypes.string,
  reason: PropTypes.string,
})

export const tenantShape = PropTypes.shape({
  id: idProp,
  band_name: PropTypes.string,
  formal_name: PropTypes.string,
  logo_path: PropTypes.string,
  applies_kor: PropTypes.bool,
  tax_percentage: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  address_street: PropTypes.string,
  address_postal_code: PropTypes.string,
  address_city: PropTypes.string,
  address_country: PropTypes.string,
  kvk_number: PropTypes.string,
  iban: PropTypes.string,
  tax_id: PropTypes.string,
})

export const invoiceLineShape = PropTypes.shape({
  id: idProp,
  description: PropTypes.string,
  quantity: PropTypes.number,
  unit_price_cents: PropTypes.number,
  tax_percentage: PropTypes.number,
  position: PropTypes.number,
})

export const invoiceShape = PropTypes.shape({
  id: idProp,
  invoice_number: PropTypes.string,
  status: PropTypes.string,
  finalized_at: PropTypes.string,
  issue_date: PropTypes.string,
  due_date: PropTypes.string,
  payment_term_days: PropTypes.number,
  customer_name: PropTypes.string,
  total_cents: PropTypes.number,
  pdf_path: PropTypes.string,
  custom_logo_path: PropTypes.string,
  invert_logo: PropTypes.bool,
  mollie_payment_link_id: PropTypes.string,
  mollie_payment_link_url: PropTypes.string,
  mollie_payment_status: PropTypes.string,
  lines: PropTypes.arrayOf(invoiceLineShape),
  tenant: tenantShape,
})

export const songTagShape = PropTypes.shape({
  id: idProp,
  name: PropTypes.string,
})

export const songLinkShape = PropTypes.shape({
  id: idProp,
  label: PropTypes.string,
  url: PropTypes.string,
  sort_order: PropTypes.number,
})

// Documents and recordings share this stored-file shape.
export const songFileShape = PropTypes.shape({
  id: idProp,
  object_key: PropTypes.string,
  original_filename: PropTypes.string,
  content_type: PropTypes.string,
  file_size: PropTypes.number,
  uploaded_at: PropTypes.string,
})

export const songShape = PropTypes.shape({
  id: idProp,
  title: PropTypes.string,
  artist: PropTypes.string,
  song_key: PropTypes.string,
  tempo: PropTypes.number,
  duration_seconds: PropTypes.number,
  lyrics_html: PropTypes.string,
  notes: PropTypes.string,
  tags: PropTypes.arrayOf(songTagShape),
  links: PropTypes.arrayOf(songLinkShape),
  documents: PropTypes.arrayOf(songFileShape),
  recordings: PropTypes.arrayOf(songFileShape),
})

export const setlistItemShape = PropTypes.shape({
  id: idProp,
  item_type: PropTypes.oneOf(['song', 'pause', 'break']),
  song_id: idProp,
  duration_seconds: PropTypes.number,
  label: PropTypes.string,
  sort_order: PropTypes.number,
  linked_to_next: PropTypes.bool,
  transition_note: PropTypes.string,
  // enrichment for song items (joined server-side)
  title: PropTypes.string,
  artist: PropTypes.string,
  song_key: PropTypes.string,
  tempo: PropTypes.number,
  tag: PropTypes.string,
})

export const setlistSetShape = PropTypes.shape({
  id: idProp,
  name: PropTypes.string,
  include_in_total: PropTypes.bool,
  sort_order: PropTypes.number,
  items: PropTypes.arrayOf(setlistItemShape),
})

export const setlistShape = PropTypes.shape({
  id: idProp,
  name: PropTypes.string,
  total_seconds: PropTypes.number,
  set_count: PropTypes.number,
  song_count: PropTypes.number,
  sets: PropTypes.arrayOf(setlistSetShape),
})

// The per-cell view model produced by buildCalendarCellViewModel.
export const calendarCellShape = PropTypes.shape({
  iso: PropTypes.string.isRequired,
  date: PropTypes.instanceOf(Date).isRequired,
  inMonth: PropTypes.bool,
  isRowStart: PropTypes.bool,
  week: PropTypes.number,
  cellSlots: PropTypes.arrayOf(slotShape),
  cellGigs: PropTypes.arrayOf(gigShape),
  cellRehearsals: PropTypes.arrayOf(rehearsalShape),
  cellBandEvents: PropTypes.arrayOf(bandEventShape),
  isSelected: PropTypes.bool,
  isToday: PropTypes.bool,
  isWeekend: PropTypes.bool,
  bgcolor: PropTypes.string,
})
