ALTER TABLE band_members
  ADD COLUMN roles TEXT[] NOT NULL DEFAULT '{}';

-- Preserve legacy values that already match the fixed catalog. Comma, slash,
-- and semicolon-separated values are recognized and retain their input order.
UPDATE band_members bm
   SET roles = COALESCE((
     SELECT array_agg(matched.canonical ORDER BY matched.first_ordinal)
       FROM (
         SELECT canonical, MIN(part.ordinality) AS first_ordinal
           FROM regexp_split_to_table(bm.role, '\s*[,;/]\s*')
                WITH ORDINALITY AS part(value, ordinality)
           JOIN unnest(ARRAY[
             'Drums', 'Percussion', 'Bass Guitar', 'Rhythm Guitar',
             'Lead Guitar', 'Keyboards', 'Synthesizers', 'Piano',
             'Electric Organ', 'Hammond', 'Wurlitzer', 'Electric Piano',
             'Lead Vocals', 'Background Vocals', 'Trumpet', 'Saxophone',
             'Trombone', 'French Horn', 'Violin', 'Fiddle', 'Viola', 'Cello',
             'Pedal Steel', 'Lap Steel Guitar', 'Mandolin', 'Banjo', 'Ukulele',
             'Harp', 'DJ', 'Sampler', 'Multi-Instrumentalist'
           ]::TEXT[]) AS allowed(canonical)
             ON LOWER(allowed.canonical) = LOWER(TRIM(part.value))
          GROUP BY canonical
       ) matched
   ), '{}')
 WHERE bm.role IS NOT NULL
   AND CARDINALITY(bm.roles) = 0;

ALTER TABLE band_members
  ADD CONSTRAINT band_members_roles_allowed_check
  CHECK (roles <@ ARRAY[
    'Drums', 'Percussion', 'Bass Guitar', 'Rhythm Guitar',
    'Lead Guitar', 'Keyboards', 'Synthesizers', 'Piano',
    'Electric Organ', 'Hammond', 'Wurlitzer', 'Electric Piano',
    'Lead Vocals', 'Background Vocals', 'Trumpet', 'Saxophone',
    'Trombone', 'French Horn', 'Violin', 'Fiddle', 'Viola', 'Cello',
    'Pedal Steel', 'Lap Steel Guitar', 'Mandolin', 'Banjo', 'Ukulele',
    'Harp', 'DJ', 'Sampler', 'Multi-Instrumentalist'
  ]::TEXT[]);
