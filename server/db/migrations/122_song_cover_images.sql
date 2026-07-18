-- Square cover image per song, stored in object storage under
-- tenants/<tenant_id>/song_covers/<uuid>.webp (always re-encoded to WebP).
ALTER TABLE songs ADD COLUMN cover_image_path TEXT;
