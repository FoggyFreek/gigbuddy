export {
  TENANT_CAPABILITIES,
  tenantKindSupports,
} from '../../shared/tenantCapabilities.js'

import {
  TENANT_CAPABILITIES as CAPABILITY_VALUES,
} from '../../shared/tenantCapabilities.js'

export type TenantCapability =
  (typeof CAPABILITY_VALUES)[keyof typeof CAPABILITY_VALUES]
