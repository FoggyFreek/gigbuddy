ALTER TABLE gig_tasks
  ADD COLUMN assigned_to INTEGER REFERENCES band_members(id) ON DELETE SET NULL;
