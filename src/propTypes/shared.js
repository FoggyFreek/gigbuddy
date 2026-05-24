// Shared PropTypes shapes for common app entities, so table/row/form components
// declare contracts without duplicating large prop blocks (issue #56).
import PropTypes from 'prop-types'

export const idProp = PropTypes.oneOfType([PropTypes.number, PropTypes.string])

export const gigShape = PropTypes.shape({
  id: idProp,
  event_date: PropTypes.oneOfType([PropTypes.string, PropTypes.instanceOf(Date)]),
  event_description: PropTypes.string,
  status: PropTypes.string,
  start_time: PropTypes.string,
  end_time: PropTypes.string,
  venue: PropTypes.object,
  festival: PropTypes.object,
  open_task_count: PropTypes.number,
})

export const participantShape = PropTypes.shape({
  band_member_id: idProp,
  name: PropTypes.string,
  color: PropTypes.string,
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
