import 'i18next'
import type { resources, defaultNS } from './index.ts'

// Wires the resource JSON into i18next's types so the selector API
// (`t($ => $.key)`) is fully type-checked: a renamed or missing key becomes a
// compile error under `npm run type-check`, not a silent runtime fallback.
// `enableSelector` turns on the selector/destructure form (default in i18next v26,
// set explicitly here to be safe). The `en` resource is the canonical key shape.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: typeof defaultNS
    resources: (typeof resources)['en']
    enableSelector: true
  }
}
