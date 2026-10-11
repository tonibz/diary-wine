CREATE OR REPLACE FUNCTION public.lookup_appellations(_names text[])
 RETURNS TABLE(idx integer, id uuid, name text, country text, region text, typical_colour text, grapes jsonb, grape_count integer, score numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH q AS (
    SELECT i AS idx, public.normalize_wine_text(_names[i]) AS nn
    FROM generate_subscripts(_names, 1) AS i
    WHERE auth.uid() IS NOT NULL
  )
  SELECT q.idx, m.id, m.name, m.country, m.region, m.typical_colour,
         m.grapes, m.grape_count, m.score
  FROM q
  CROSS JOIN LATERAL (
    SELECT a.id, a.name, a.country, a.region, a.typical_colour, a.grapes, a.grape_count,
           (CASE WHEN a.norm_name = q.nn THEN 1
                 ELSE similarity(a.norm_name, q.nn) END)::numeric AS score
    FROM public.appellations a
    WHERE a.norm_name % q.nn
    ORDER BY (CASE WHEN a.norm_name = q.nn THEN 1
                   ELSE similarity(a.norm_name, q.nn) END) DESC
    LIMIT 1
  ) m
  WHERE q.nn IS NOT NULL AND q.nn <> '';
$function$;