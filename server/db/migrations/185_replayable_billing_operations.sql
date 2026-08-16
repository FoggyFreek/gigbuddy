-- Make provider mutations independently replayable. The command contains only
-- the provider-neutral port arguments and an idempotent local completion step.
-- Existing operations remain visible but are not guessed at: only newly
-- recorded commands can be replayed safely.

ALTER TABLE billing_operations
  ADD COLUMN command_payload JSONB,
  ADD COLUMN result_payload JSONB,
  ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  ADD COLUMN next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN lease_expires_at TIMESTAMPTZ,
  ADD COLUMN completed_at TIMESTAMPTZ,
  ADD CONSTRAINT billing_operations_command_object CHECK (
    command_payload IS NULL OR jsonb_typeof(command_payload) = 'object'
  ),
  ADD CONSTRAINT billing_operations_result_object CHECK (
    result_payload IS NULL OR jsonb_typeof(result_payload) = 'object'
  );

CREATE INDEX billing_operations_recovery_idx
  ON billing_operations (next_attempt_at, id)
  WHERE completed_at IS NULL
    AND status IN ('pending', 'failed_retryable', 'succeeded', 'failed_terminal');
