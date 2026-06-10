// Data-access helpers for journals (user-entered ledger postings). Each takes an
// `executor` (a pool or a transaction client) so callers control transaction
// boundaries.

export async function fetchJournal(executor, tenantId, journalId) {
  const { rows } = await executor.query(
    'SELECT * FROM journals WHERE id = $1 AND tenant_id = $2',
    [journalId, tenantId],
  )
  return rows[0] || null
}

export async function fetchJournalLines(executor, journalId, tenantId) {
  const { rows } = await executor.query(
    `SELECT id, description, account_code, vat_rate, side, amount_cents,
            balancing_account_code, position
       FROM journal_lines
      WHERE journal_id = $1 AND tenant_id = $2
      ORDER BY position ASC, id ASC`,
    [journalId, tenantId],
  )
  return rows
}

// Lists journal headers with their lines for the tenant, newest entry first.
export async function listJournals(executor, tenantId) {
  const { rows: journals } = await executor.query(
    `SELECT id, entry_number, entry_date, description, status,
            posted_transaction_id, created_at, updated_at
       FROM journals
      WHERE tenant_id = $1
      ORDER BY entry_date DESC, entry_number DESC, id DESC`,
    [tenantId],
  )
  if (!journals.length) return []
  const ids = journals.map((j) => j.id)
  const { rows: lines } = await executor.query(
    `SELECT id, journal_id, description, account_code, vat_rate, side,
            amount_cents, balancing_account_code, position
       FROM journal_lines
      WHERE tenant_id = $1 AND journal_id = ANY($2)
      ORDER BY position ASC, id ASC`,
    [tenantId, ids],
  )
  const byJournal = new Map(journals.map((j) => [j.id, { ...j, lines: [] }]))
  for (const l of lines) byJournal.get(l.journal_id)?.lines.push(l)
  return journals.map((j) => byJournal.get(j.id))
}

// Per-tenant monotonic counter for entry numbers. Atomic UPSERT avoids the
// MAX(entry_number) race inside a transaction (mirrors nextPurchaseNumber).
export async function nextJournalNumber(executor, tenantId) {
  const { rows } = await executor.query(
    `INSERT INTO journal_number_sequences (tenant_id, next_seq)
     VALUES ($1, 2)
     ON CONFLICT (tenant_id)
     DO UPDATE SET next_seq = journal_number_sequences.next_seq + 1
     RETURNING next_seq - 1 AS seq`,
    [tenantId],
  )
  return rows[0].seq
}

export async function insertJournalLines(executor, journalId, tenantId, lines) {
  for (const line of lines) {
    await executor.query(
      `INSERT INTO journal_lines
         (journal_id, tenant_id, position, description, account_code, vat_rate, side, amount_cents, balancing_account_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        journalId, tenantId, line.position, line.description,
        line.account_code ?? null, line.vat_rate, line.side ?? null,
        line.amount_cents, line.balancing_account_code ?? null,
      ],
    )
  }
}

export async function replaceJournalLines(executor, journalId, tenantId, lines) {
  await executor.query(
    'DELETE FROM journal_lines WHERE journal_id = $1 AND tenant_id = $2',
    [journalId, tenantId],
  )
  await insertJournalLines(executor, journalId, tenantId, lines)
}

// Inserts a draft journal header and returns its id. Assigns the next entry
// number from the sequence table.
export async function createJournal(executor, tenantId, { entryDate, description }) {
  const entryNumber = await nextJournalNumber(executor, tenantId)
  const { rows } = await executor.query(
    `INSERT INTO journals (tenant_id, entry_number, entry_date, description)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [tenantId, entryNumber, entryDate, description ?? null],
  )
  return rows[0].id
}

export async function updateJournalHeader(executor, tenantId, journalId, { entryDate, description }) {
  await executor.query(
    `UPDATE journals SET entry_date = $1, description = $2, updated_at = NOW()
      WHERE id = $3 AND tenant_id = $4`,
    [entryDate, description ?? null, journalId, tenantId],
  )
}

// Locks the journal row for the duration of the surrounding transaction so a
// concurrent approve of the same draft can't double-post.
export async function lockJournalForApprove(executor, tenantId, journalId) {
  const { rows } = await executor.query(
    'SELECT * FROM journals WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
    [journalId, tenantId],
  )
  return rows[0] || null
}

// Flips a draft to approved only if it is still a draft (the WHERE guard plus the
// row lock is the concurrency guard). Returns the updated row, or null if another
// transaction already approved it.
export async function setApproved(executor, tenantId, journalId, transactionId) {
  const { rows } = await executor.query(
    `UPDATE journals
        SET status = 'approved', posted_transaction_id = $1, updated_at = NOW()
      WHERE id = $2 AND tenant_id = $3 AND status = 'draft'
      RETURNING *`,
    [transactionId, journalId, tenantId],
  )
  return rows[0] || null
}

export async function deleteJournal(executor, tenantId, journalId) {
  await executor.query(
    'DELETE FROM journals WHERE id = $1 AND tenant_id = $2',
    [journalId, tenantId],
  )
}

// Returns the subset of `codes` that exist for the tenant and are active. Used
// at approve time to require active accounts on every postable line.
export async function fetchActiveAccountCodes(executor, tenantId, codes) {
  const unique = [...new Set(codes.filter(Boolean))]
  if (!unique.length) return new Set()
  const { rows } = await executor.query(
    `SELECT code FROM chart_of_accounts
      WHERE tenant_id = $1 AND code = ANY($2) AND is_active`,
    [tenantId, unique],
  )
  return new Set(rows.map((r) => r.code))
}

// Returns the subset of `codes` that exist for the tenant (active or not). Used
// at draft save to reject unknown codes with a clean 400 before the FK throws.
export async function fetchExistingAccountCodes(executor, tenantId, codes) {
  const unique = [...new Set(codes.filter(Boolean))]
  if (!unique.length) return new Set()
  const { rows } = await executor.query(
    `SELECT code FROM chart_of_accounts WHERE tenant_id = $1 AND code = ANY($2)`,
    [tenantId, unique],
  )
  return new Set(rows.map((r) => r.code))
}
