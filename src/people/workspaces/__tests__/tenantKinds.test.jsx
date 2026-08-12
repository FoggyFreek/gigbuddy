import { describe, expect, it } from 'vitest'

import * as shared from '../../../../shared/tenantKinds.js'
import * as frontend from '../../../auth/tenantKinds.ts'

describe('tenant kind parity', () => {
  it('keeps the typed frontend adapter aligned with the shared constants', () => {
    expect(frontend.TENANT_KINDS).toBe(shared.TENANT_KINDS)
    expect(frontend.DEFAULT_TENANT_KIND).toBe(shared.DEFAULT_TENANT_KIND)
    expect(frontend.TENANT_KINDS).toEqual(['band', 'personal'])
  })
})
