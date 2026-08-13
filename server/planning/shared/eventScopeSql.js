// The participation predicate shared by every cross-tenant artist read
// (/api/me). Band and personal workspaces follow the same rule: the caller sees
// an event when their linked member is a participant.
//
// Emits SQL only — the caller owns the parameter positions and passes the
// placeholder holding the user id.

export function memberEventScopeSql({ alias, participantTable, eventFk, userParam }) {
  return `EXISTS (
    SELECT 1
      FROM ${participantTable} scope_participant
      JOIN band_members scope_member
        ON scope_member.id = scope_participant.band_member_id
       AND scope_member.tenant_id = scope_participant.tenant_id
     WHERE scope_participant.${eventFk} = ${alias}.id
       AND scope_participant.tenant_id = ${alias}.tenant_id
       AND scope_member.user_id = ${userParam}
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
