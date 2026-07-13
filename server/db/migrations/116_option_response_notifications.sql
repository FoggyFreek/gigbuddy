-- Persist the one-shot "first unavailable response" event on each option.
-- The timestamp is claimed in the same transaction as the vote so concurrent
-- responses cannot produce duplicate organizer notifications.
ALTER TABLE gigs
  ADD COLUMN first_unavailable_notification_at TIMESTAMPTZ;

ALTER TABLE rehearsals
  ADD COLUMN first_unavailable_notification_at TIMESTAMPTZ;
