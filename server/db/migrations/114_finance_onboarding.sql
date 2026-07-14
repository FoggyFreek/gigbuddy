-- Finance onboarding + an expandable in-app tutorial system.
--
-- Two concerns:
--  1. A generic, per-user (global) record of which tutorials a user has
--     dismissed, keyed by a stable `tutorial_key`. New tutorials are added by
--     registering a key on the frontend — no schema change per tutorial. The
--     finance welcome is the first key ('finance_welcome').
--  2. The opening balance carried by a staged bank statement, so the finance
--     import nudge can offer to set it. Staged (not client-supplied) so
--     committing the opening balance never trusts client money.

-- Per-user, per-tutorial dismissal. Deliberately user-level, not per-tenant:
-- a dismissed tutorial stays dismissed for that user everywhere.
CREATE TABLE user_tutorial_dismissals (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tutorial_key TEXT NOT NULL,
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, tutorial_key)
);

-- Signed cents: positive = a normal (credit/CRDT) positive account balance;
-- negative = an overdrawn (debit/DBIT) balance. NULL when the statement carried
-- no opening-balance element.
ALTER TABLE bank_statement_imports
  ADD COLUMN opening_balance_cents INTEGER,
  ADD COLUMN opening_balance_date DATE;
