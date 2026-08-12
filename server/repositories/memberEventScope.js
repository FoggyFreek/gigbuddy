// The participation predicate shared by every cross-tenant artist read
// (/api/me). Within a band, the caller only sees events their linked roster
// member is booked on; their own personal workspace is intrinsically theirs, so
// it is not filtered at all.
//
// Emits SQL only — the caller owns the parameter positions and passes the
// placeholder holding the user id.

export function memberEventScopeSql({ alias, participantTable, eventFk, userParam }) {
  return `(
    EXISTS (
      SELECT 1 FROM tenants scope_tenant
       WHERE scope_tenant.id = ${alias}.tenant_id AND scope_tenant.kind = 'personal'
    )
    OR EXISTS (
      SELECT 1
        FROM ${participantTable} scope_participant
        JOIN band_members scope_member
          ON scope_member.id = scope_participant.band_member_id
         AND scope_member.tenant_id = scope_participant.tenant_id
       WHERE scope_participant.${eventFk} = ${alias}.id
         AND scope_participant.tenant_id = ${alias}.tenant_id
         AND scope_member.user_id = ${userParam}
    )
  )`
}

export const gigScopeSql = (alias, userParam) => memberEventScopeSql({
  alias, participantTable: 'gig_participants', eventFk: 'gig_id', userParam,
})

export const rehearsalScopeSql = (alias, userParam) => memberEventScopeSql({
  alias, participantTable: 'rehearsal_participants', eventFk: 'rehearsal_id', userParam,
})

export const bandEventScopeSql = (alias, userParam) => memberEventScopeSql({
  alias, participantTable: 'band_event_participants', eventFk: 'band_event_id', userParam,
})
