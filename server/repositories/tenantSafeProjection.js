const SAFE_TENANT_COLUMNS = Object.freeze([
  'id', 'slug', 'band_name', 'bio',
  'instagram_handle', 'facebook_handle', 'tiktok_handle', 'youtube_handle', 'spotify_handle',
  'logo_path', 'created_by_user_id', 'created_at', 'updated_at', 'archived_at',
  'accent_color', 'bandsintown_artist_name', 'bandsintown_artist_id',
  'formal_name', 'address_street', 'address_postal_code', 'address_city', 'address_country',
  'kvk_number', 'iban', 'tax_id', 'tax_percentage', 'applies_kor',
  'banner_path', 'avatar_path', 'logo_dark_path',
  'memory_image_path', 'memory_caption', 'memory_gig_id',
  'owner_user_id',
])

export function tenantSafeProjection(alias = null) {
  if (alias !== null && !/^[a-z][a-z0-9_]*$/i.test(alias)) throw new Error('Invalid SQL alias')
  return SAFE_TENANT_COLUMNS.map((column) => alias ? `${alias}.${column}` : column).join(', ')
}

