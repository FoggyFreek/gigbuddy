// Tier logos for the default subscription plans. Plans without a dedicated
// logo (custom slugs) get null — callers fall back to the standard app logo
// or render nothing.
const TIER_LOGOS: Record<string, string> = {
  bronze: '/icons/gb_bronze.png',
  silver: '/icons/gb_silver.png',
  gold: '/icons/gb_gold.png',
}

export function planLogoSrc(slug: string | null | undefined): string | null {
  return slug ? TIER_LOGOS[slug] ?? null : null
}
