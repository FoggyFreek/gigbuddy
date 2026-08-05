ALTER TABLE band_events
  ADD CONSTRAINT band_events_id_tenant_id_key UNIQUE (id, tenant_id);

CREATE TABLE band_event_participants (
  id             SERIAL PRIMARY KEY,
  tenant_id      INTEGER NOT NULL,
  band_event_id  INTEGER NOT NULL,
  band_member_id INTEGER NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (band_event_id, band_member_id),
  FOREIGN KEY (band_event_id, tenant_id)
    REFERENCES band_events(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (band_member_id, tenant_id)
    REFERENCES band_members(id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX band_event_participants_event_idx
  ON band_event_participants (tenant_id, band_event_id);

-- Existing events receive the same initial roster as newly created events.
INSERT INTO band_event_participants (tenant_id, band_event_id, band_member_id)
SELECT event.tenant_id, event.id, member.id
  FROM band_events event
  JOIN band_members member
    ON member.tenant_id = event.tenant_id
   AND member.position = 'lead';
