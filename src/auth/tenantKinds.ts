import {
  DEFAULT_TENANT_KIND,
  TENANT_KINDS,
} from '../../shared/tenantKinds.js'

export { DEFAULT_TENANT_KIND, TENANT_KINDS }

export type TenantKind = (typeof TENANT_KINDS)[number]
