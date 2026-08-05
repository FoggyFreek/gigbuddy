// Achievement registry — the single place a new achievement is defined.
//
// Contract:
// - key:      stable snake_case id. It is persisted in tenant_achievements and
//             doubles as the frontend i18n key (achievements.items.<key>) and
//             icon-map key. NEVER rename a shipped key — only add new ones.
// - kinds:    which tenant kinds can earn it. The catalogue is a FUNCTION of
//             tenant kind, not a subset of the band list: there are band-only
//             achievements, personal-only ones no band can ever earn, and a few
//             that mean the same to either. Every shipped definition is
//             explicitly ['band'] — a solo artist gets their own titles, since
//             these are written in a band voice.
// - category: one of CATEGORIES (drives page grouping and fallback icon).
// - cheers:   integer 1–10, the achievement's worth.
// - title:    canonical English title, used verbatim in the unlock
//             notification. Page copy (title + description) lives in the
//             frontend i18n `achievements` namespace under the same key.
// - test:     PURE predicate (facts, unlockedKeys) => boolean. No I/O and no
//             Date.now() — anything "now"-derived belongs in the facts object
//             (see factsBuilder.js). Most tests ignore the second argument;
//             meta-achievements read `unlockedKeys` (a Set of keys unlocked so
//             far, including ones unlocked earlier in the same evaluation
//             pass) and therefore MUST be declared after their prerequisites.
//
// Adding an achievement = one entry here + en/nl copy in
// src/i18n/{en,nl}/achievements.json (nl parity is compile-enforced) and
// optionally an icon in src/components/achievements/achievementIcons.ts.

export const CATEGORIES = Object.freeze([
  'profile',
  'gigs',
  'invoices',
  'purchase',
  'merchandise',
  'finance',
  'platform',
  'repertoire',
  'network',
  // Personal-only territory: milestones a band has no equivalent for.
  'artist',
])

const BAND = Object.freeze(['band'])
const PERSONAL = Object.freeze(['personal'])

const PROFILE_PREREQ_KEYS = [
  'logo_a_go_go',
  'now_were_photogenic',
  'big_banner_energy',
  'proper_band_honestly',
  'three_chords_three_humans',
  'the_dep_list_deepens',
  'bring_your_own_bassist',
]

export const ACHIEVEMENT_DEFINITIONS = Object.freeze([
  // ---- profile ----
  {
    key: 'logo_a_go_go',
    kinds: BAND,
    category: 'profile',
    cheers: 2,
    title: 'Logo A-Go-Go',
    test: (f) => f.profile.hasLogo && f.profile.hasDarkLogo,
  },
  {
    key: 'now_were_photogenic',
    kinds: BAND,
    category: 'profile',
    cheers: 1,
    title: 'Now We’re Photogenic',
    test: (f) => f.profile.hasAvatar,
  },
  {
    key: 'big_banner_energy',
    kinds: BAND,
    category: 'profile',
    cheers: 1,
    title: 'Big Banner Energy',
    test: (f) => f.profile.hasBanner,
  },
  {
    key: 'proper_band_honestly',
    kinds: BAND,
    category: 'profile',
    cheers: 3,
    title: 'Proper Band, Honestly',
    test: (f) =>
      f.profile.hasBandName &&
      f.profile.hasBio &&
      f.profile.hasAvatar &&
      f.profile.hasBanner &&
      f.profile.hasLogo &&
      f.profile.hasDarkLogo &&
      f.profile.socialsCount >= 1,
  },
  {
    key: 'three_chords_three_humans',
    kinds: BAND,
    category: 'profile',
    cheers: 2,
    title: 'Three Chords, Three Humans',
    test: (f) => f.members.total >= 3,
  },
  {
    key: 'the_dep_list_deepens',
    kinds: BAND,
    category: 'profile',
    cheers: 3,
    title: 'The Dep List Deepens',
    test: (f) => f.members.optional >= 1 && f.members.subs >= 1,
  },
  {
    key: 'bring_your_own_bassist',
    kinds: BAND,
    category: 'profile',
    cheers: 4,
    title: 'Bring Your Own Bassist',
    test: (f) => f.members.redeemedInvites >= 1,
  },
  {
    // Meta-achievement: every other profile achievement. Declared after its
    // prerequisites so a single ordered evaluation pass unlocks it together
    // with the last prerequisite.
    key: 'fully_plugged_in',
    kinds: BAND,
    category: 'profile',
    cheers: 8,
    title: 'Fully Plugged In',
    test: (_f, unlockedKeys) => PROFILE_PREREQ_KEYS.every((k) => unlockedKeys.has(k)),
  },

  // ---- gigs & events ----
  {
    key: 'first_rehearsal_last_excuse',
    kinds: BAND,
    category: 'gigs',
    cheers: 1,
    title: 'First Rehearsal, Last Excuse',
    test: (f) => f.planning.rehearsals >= 1,
  },
  {
    key: 'calendar_rock',
    kinds: BAND,
    category: 'gigs',
    cheers: 1,
    title: 'Calendar Rock',
    test: (f) => f.planning.bandEvents >= 1,
  },
  {
    key: 'this_ones_actually_happening',
    kinds: BAND,
    category: 'gigs',
    cheers: 2,
    title: 'This One’s Actually Happening',
    test: (f) => f.gigs.nonOption >= 1,
  },
  {
    key: 'ten_gigs_no_cry',
    kinds: BAND,
    category: 'gigs',
    cheers: 4,
    title: 'Ten Gigs, No Cry',
    test: (f) => f.gigs.nonOption >= 10,
  },
  {
    key: 'fifty_shades_of_soundcheck',
    kinds: BAND,
    category: 'gigs',
    cheers: 7,
    title: 'Fifty Shades of Soundcheck',
    test: (f) => f.gigs.nonOption >= 50,
  },
  {
    key: 'tour_bus_not_included',
    kinds: BAND,
    category: 'gigs',
    cheers: 10,
    title: 'Tour Bus Not Included',
    test: (f) => f.gigs.total >= 150,
  },
  {
    key: 'five_city_shuffle',
    kinds: BAND,
    category: 'gigs',
    cheers: 4,
    title: 'Five-City Shuffle',
    test: (f) => f.gigs.playedCities >= 5,
  },
  {
    key: 'the_van_has_opinions',
    kinds: BAND,
    category: 'gigs',
    cheers: 8,
    title: 'The Van Has Opinions',
    test: (f) => f.gigs.playedCities >= 25,
  },
  {
    key: 'international_noise_complaint',
    kinds: BAND,
    category: 'gigs',
    cheers: 6,
    title: 'International Noise Complaint',
    test: (f) => f.gigs.playedCountries >= 2,
  },
  {
    key: 'took_this_band_to_town',
    kinds: BAND,
    category: 'gigs',
    cheers: 3,
    title: 'Took This Band to Town',
    test: (f) => f.integrations.bandsintownConfigured,
  },

  // ---- invoices ----
  {
    key: 'please_pay_the_piper',
    kinds: BAND,
    category: 'invoices',
    cheers: 3,
    title: 'Please Pay the Piper',
    test: (f) => f.invoices.sent >= 1,
  },
  {
    key: 'power_to_the_payments',
    kinds: BAND,
    category: 'invoices',
    cheers: 3,
    title: 'Power to the Payments',
    test: (f) => f.integrations.mollieConfigured,
  },

  // ---- purchase ----
  {
    key: 'gear_acquisition_syndrome',
    kinds: BAND,
    category: 'purchase',
    cheers: 2,
    title: 'Gear Acquisition Syndrome',
    test: (f) => f.purchases.booked >= 1,
  },

  // ---- merchandise ----
  {
    key: 'shirts_before_hits',
    kinds: BAND,
    category: 'merchandise',
    cheers: 2,
    title: 'Shirts Before Hits',
    test: (f) => f.merch.products >= 1,
  },
  {
    key: 'box_set_behavior',
    kinds: BAND,
    category: 'merchandise',
    cheers: 3,
    title: 'Box Set Behavior',
    test: (f) => f.merch.inventoryOrders >= 1,
  },
  {
    key: 'cash_from_the_merch_pit',
    kinds: BAND,
    category: 'merchandise',
    cheers: 4,
    title: 'Cash from the Merch Pit',
    test: (f) => f.merch.sales >= 1,
  },
  {
    key: 'sync_that_chop_shop',
    kinds: BAND,
    category: 'merchandise',
    cheers: 3,
    title: 'Sync That Chop Shop',
    test: (f) => f.integrations.shopifyConfigured,
  },

  // ---- finance ----
  {
    key: 'black_ink_sabbath',
    kinds: BAND,
    category: 'finance',
    cheers: 5,
    title: 'Black Ink Sabbath',
    test: (f) => f.finance.hasProfitableMonth,
  },
  {
    key: 'the_blues_ledger',
    kinds: BAND,
    category: 'finance',
    cheers: 2,
    title: 'The Blues Ledger',
    test: (f) => f.finance.hasLossMonth,
  },

  // ---- platform ----
  {
    key: 'welcome_to_the_giggle',
    kinds: BAND,
    category: 'platform',
    cheers: 1,
    title: 'Welcome to the Giggle',
    test: () => true,
  },
  {
    key: 'one_month_still_tuning',
    kinds: BAND,
    category: 'platform',
    cheers: 2,
    title: 'One Month, Still Tuning',
    test: (f) => f.tenant.ageDays >= 30,
  },
  {
    key: 'still_standing_still_loud',
    kinds: BAND,
    category: 'platform',
    cheers: 7,
    title: 'Still Standing, Still Loud',
    test: (f) => f.tenant.ageDays >= 365,
  },

  // ---- repertoire ----
  {
    key: 'five_songs_and_a_prayer',
    kinds: BAND,
    category: 'repertoire',
    cheers: 2,
    title: 'Five Songs and a Prayer',
    test: (f) => f.repertoire.songs >= 5,
  },
  {
    key: 'setlist_match_fire',
    kinds: BAND,
    category: 'repertoire',
    cheers: 3,
    title: 'Setlist, Match, Fire',
    test: (f) => f.repertoire.maxSetlistSongs >= 5,
  },
  {
    key: 'my_personal_high_note',
    kinds: BAND,
    category: 'repertoire',
    cheers: 1,
    title: 'My Personal High Note',
    test: (f) => f.repertoire.hasPersonalSetlistNote,
  },
  {
    key: 'judging_the_song_by_its_cover',
    kinds: BAND,
    category: 'repertoire',
    cheers: 1,
    title: 'Judging the Song by Its Cover',
    test: (f) => f.repertoire.hasSongCover,
  },
  {
    key: 'linkin_spark',
    kinds: BAND,
    category: 'repertoire',
    cheers: 1,
    title: 'Linkin’ Spark',
    test: (f) => f.repertoire.hasSongLink,
  },
  {
    key: 'now_with_actual_sound',
    kinds: BAND,
    category: 'repertoire',
    cheers: 1,
    title: 'Now With Actual Sound',
    test: (f) => f.repertoire.hasSongRecording,
  },

  // ---- network ----
  {
    key: 'fifty_people_who_might_answer',
    kinds: BAND,
    category: 'network',
    cheers: 5,
    title: 'Fifty People Who Might Answer',
    test: (f) => f.network.contacts > 50,
  },

  // ---- artist workspace (personal only) ----
  // New keys, not reused band ones: the shipped titles are written in a band
  // voice ("Three Chords Three Humans"), and a solo artist needs their own.
  {
    key: 'a_stage_name_and_a_face',
    kinds: PERSONAL,
    category: 'artist',
    cheers: 2,
    title: 'A Stage Name And A Face',
    test: (f) => f.profile.hasBandName && f.profile.hasAvatar,
  },
  {
    key: 'presentable_on_paper',
    kinds: PERSONAL,
    category: 'artist',
    cheers: 3,
    title: 'Presentable On Paper',
    test: (f) =>
      f.profile.hasBandName &&
      f.profile.hasBio &&
      f.profile.hasAvatar &&
      f.profile.socialsCount >= 1,
  },
  {
    key: 'first_one_in_the_diary',
    kinds: PERSONAL,
    category: 'artist',
    cheers: 2,
    title: 'First One In The Diary',
    test: (f) => f.gigs.nonOption >= 1,
  },
  {
    key: 'twenty_five_nights_of_my_own',
    kinds: PERSONAL,
    category: 'artist',
    cheers: 5,
    title: 'Twenty-Five Nights Of My Own',
    test: (f) => f.gigs.nonOption >= 25,
  },
  {
    key: 'my_own_books_thanks',
    kinds: PERSONAL,
    category: 'artist',
    cheers: 4,
    title: 'My Own Books, Thanks',
    test: (f) => f.invoices.sent >= 1 && f.purchases.booked >= 1,
  },
  {
    key: 'invoice_number_one',
    kinds: PERSONAL,
    category: 'artist',
    cheers: 3,
    title: 'Invoice Number One',
    test: (f) => f.invoices.sent >= 1,
  },
  {
    key: 'a_month_in_the_black_solo',
    kinds: PERSONAL,
    category: 'artist',
    cheers: 6,
    title: 'A Month In The Black',
    test: (f) => f.finance.hasProfitableMonth,
  },
  {
    key: 'my_own_little_black_book',
    kinds: PERSONAL,
    category: 'artist',
    cheers: 3,
    title: 'My Own Little Black Book',
    test: (f) => f.network.contacts >= 10,
  },
  {
    key: 'songs_i_can_actually_play',
    kinds: PERSONAL,
    category: 'artist',
    cheers: 3,
    title: 'Songs I Can Actually Play',
    test: (f) => f.repertoire.songs >= 10,
  },
])

const byKey = new Map(ACHIEVEMENT_DEFINITIONS.map((d) => [d.key, d]))

export function getDefinition(key) {
  return byKey.get(key) ?? null
}

// The catalogue for a tenant kind. Filtering happens BEFORE evaluation, so a
// band's definitions are never even tested in a personal workspace (and the
// facts they need are never queried — see factsBuilder).
//
// Totals are only comparable WITHIN a kind: any "x of y unlocked" figure must
// count against this list, never the union.
export function definitionsForKind(kind) {
  return ACHIEVEMENT_DEFINITIONS.filter((d) => d.kinds.includes(kind))
}
