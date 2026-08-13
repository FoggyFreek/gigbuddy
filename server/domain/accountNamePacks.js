import { normalizeVatCountry } from '../../shared/vatRates.js'

// Country packs for chart-of-accounts labels.
//
// Codes, tree structure and reporting groups are universal across every
// jurisdiction; only the display name is localized. A country without a pack
// keeps the English base name from DEFAULT_ACCOUNTS.
//
// NOTE: a full country pack would eventually change the chart *structure* too
// (BE MAR, DE SKR03/SKR04). This is deliberately names-only.
//
// nl terminology follows common Dutch bookkeeping usage (RGS-flavoured).
// Source: Referentie Grootboekschema (referentiegrootboekschema.nl), checked 2026-08-13.
const ACCOUNT_NAME_PACKS = Object.freeze({
  nl: Object.freeze({
    // level 0
    '10000': 'Activa',
    '20000': 'Vreemd vermogen',
    '30000': 'Eigen vermogen',
    '40000': 'Omzet',
    '50000': 'Kostprijs van de omzet',
    '60000': 'Bedrijfskosten',
    '70000': 'Overige bedrijfsopbrengsten',
    // level 1
    '11000': 'Bankrekening',
    '11100': 'Kas',
    '12000': 'Voorraad',
    '13000': 'Apparatuur en instrumenten',
    '14000': 'Bedrijfsauto of tourbus',
    '15000': 'Te vorderen btw (voorbelasting)',
    '15010': 'Te vorderen btw van de Belastingdienst',
    '21000': 'Kortlopende schulden',
    '22000': 'Rekening-courant bandleden',
    '24000': 'Te betalen btw',
    '24010': 'Te betalen btw aan de Belastingdienst',
    '31000': 'Kapitaalstortingen bandleden',
    '32000': 'Privé-opnamen bandleden',
    '33000': 'Ingehouden winst',
    '39000': 'Openingsbalans eigen vermogen',
    '41000': 'Gages optredens',
    '42000': 'Merchandiseomzet',
    '43000': "Streaming- en downloadroyalty's",
    '44000': 'Uitgave- en synclicenties',
    '51000': 'Inkoopwaarde merchandise',
    '61000': 'Touring',
    '62000': 'Apparatuur en productie',
    '63000': 'Marketing en promotie',
    '64000': 'Algemene en administratieve kosten',
    '71000': 'Subsidies en fondsen',
    // level 2
    '11200': 'Debiteuren',
    '11300': 'Shopify Payments tussenrekening',
    '11400': 'PayPal tussenrekening',
    '12100': "Voorraad vinyl en cd's",
    '12200': 'Voorraad merchandise',
    '13100': 'Cumulatieve afschrijving apparatuur',
    '21100': 'Crediteuren',
    '21200': 'Nog te betalen kosten',
    '42100': "Merchandiseomzet vinyl en cd's",
    '51100': 'Productiekosten merchandise',
    '51200': 'Verzend- en verpakkingskosten',
    '51300': 'Merchandiseafdracht aan zalen',
    '61100': 'Reis- en verblijfkosten',
    '61200': 'Brandstof en tolkosten',
    '62100': 'Instrumenten en apparatuur',
    '62200': 'Onderhoud en reparatie apparatuur',
    '62300': 'Studiohuur en opnametechniek',
    '62400': 'Huur repetitieruimte',
    '62900': 'Afschrijvingskosten',
    '63100': 'Reclame en PR',
    '63200': 'Artwork, foto en video',
    '63300': 'Digitale distributie en softwareabonnementen',
    '64100': 'Betalingsverwerkingskosten',
    '64200': 'Ingehuurde musici en freelancers',
    '64900': 'Afrondingsverschillen btw',
  }),
})

// The country default label for an account code, falling back to the English
// base name.
//
// Deliberately does NOT fall back to DEFAULT_VAT_COUNTRY: an unknown or
// packless jurisdiction must never borrow another country's labels, so a German
// tenant gets the English base rather than Dutch.
export function getDefaultAccountName(countryCode, code, baseName) {
  const pack = ACCOUNT_NAME_PACKS[normalizeVatCountry(countryCode) ?? '']
  return pack?.[code] ?? baseName
}

// This registry is the first concern inside the versioned country pack — the
// revision that stamps a tenant is COUNTRY_PACK_REVISION in shared/countryPack.js,
// which is also where you add the next concern. Bump it there whenever a label
// here changes or a country is added.
