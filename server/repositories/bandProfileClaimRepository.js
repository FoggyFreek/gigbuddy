// Data access for band-profile claims: a band tenant asking to be recognised as
// the owner of a global profile, reviewed by a super admin.
//
// A decided claim is the audit record of that decision and outlives the profile
// it points at (band_profile_id is ON DELETE SET NULL, with band_profile_name as
// the snapshot), so nothing here may assume the profile still exists.

// Which profile a tenant is claiming, if any. Read before the tenant is deleted:
// the claim cascades away with it, which can strand the profile.
export async function listProfileIdsClaimedByTenant(executor, tenantId) {
  const { rows } = await executor.query(
    `SELECT DISTINCT band_profile_id FROM band_profile_claims
      WHERE tenant_id = $1 AND band_profile_id IS NOT NULL
      ORDER BY band_profile_id`,
    [tenantId],
  )
  return rows.map((row) => row.band_profile_id)
}
