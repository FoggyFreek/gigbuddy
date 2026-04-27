DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'venues'
      AND column_name = 'type'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'venues'
      AND column_name = 'category'
  ) THEN
    ALTER TABLE venues RENAME COLUMN type TO category;
  END IF;
END $$;
