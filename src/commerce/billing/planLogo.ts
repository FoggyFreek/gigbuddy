// Tier logos for the default subscription plans. Plans without a dedicated
// logo (custom slugs) get null — callers fall back to the standard app logo
// or render nothing.
// The artist ladder reuses the band metal art for now: a paying artist_gold
// customer must not silently fall back to the plain app logo.
// TODO: dedicated public/icons/gb_artist_*.png.
const TIER_LOGOS: Record<string, string> = {
  bronze: '/icons/gb_bronze.png',
  silver: '/icons/gb_silver.png',
  gold: '/icons/gb_gold.png',
  artist_bronze: '/icons/gb_bronze.png',
  artist_gold: '/icons/gb_gold.png',
}

export function planLogoSrc(slug: string | null | undefined): string | null {
  return slug ? TIER_LOGOS[slug] ?? null : null
}
