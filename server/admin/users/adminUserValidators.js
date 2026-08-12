// Pure request/parameter validation for super-admin user routes. No DB access here.
import { parsePositiveId as parseId } from '../../platform/http/requestValidators.js'

export { parseId }
