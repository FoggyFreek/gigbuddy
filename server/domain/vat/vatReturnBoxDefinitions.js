import {
  NL_VAT_RETURN_SCHEMA_2026,
  getNlVatReturnBoxDefinition,
} from './nlVatReturn2026.js'

const COUNTRY_PACKS = Object.freeze({
  nl: Object.freeze({
    [NL_VAT_RETURN_SCHEMA_2026.version]: Object.freeze({
      getBoxDefinition: getNlVatReturnBoxDefinition,
    }),
  }),
})

export function getVatReturnBoxDefinition(countryCode, schemaVersion, boxCode) {
  const countryPack = COUNTRY_PACKS[String(countryCode ?? '').toLowerCase()]
  const schema = countryPack?.[schemaVersion]
  return schema?.getBoxDefinition(boxCode) ?? null
}
