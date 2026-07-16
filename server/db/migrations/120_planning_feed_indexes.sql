CREATE INDEX idx_rehearsals_tenant_date_id
  ON rehearsals (tenant_id, proposed_date DESC, id DESC);

CREATE INDEX idx_band_events_tenant_end_date_id
  ON band_events (tenant_id, end_date DESC, id DESC);
