/** @type {readonly ['flat_fee', 'guarantee', 'door_deal']} */
export const DEAL_TYPES = Object.freeze(['flat_fee', 'guarantee', 'door_deal'])

/** @type {readonly ['plus', 'versus']} */
export const GUARANTEE_VARIANTS = Object.freeze(['plus', 'versus'])

/** @type {readonly ['none', 'percentage', 'amount']} */
export const FEE_BASES = Object.freeze(['none', 'percentage', 'amount'])

/** @type {readonly ['artist_agency', 'artist', 'agency']} */
export const COST_PAID_BY = Object.freeze(['artist_agency', 'artist', 'agency'])

export const DEFAULT_COST_PAID_BY = 'artist'
