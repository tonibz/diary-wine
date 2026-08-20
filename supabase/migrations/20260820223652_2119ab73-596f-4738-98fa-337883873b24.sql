CREATE OR REPLACE FUNCTION public.find_wine_matches(_names text[], _producers text[])
RETURNS TABLE(idx integer, id uuid, name text, producer text, region text, country text, score numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH q AS (
    SELECT i AS idx,
           public.normalize_wine_text(_names[i]) AS nn,
           public.normalize_wine_text(coalesce(_producers[i], '')) AS np
    FROM generate_subscripts(_names, 1) AS i
    WHERE auth.uid() IS NOT NULL
  ), scored AS (
    SELECT q.idx, w.id, w.name, w.producer, w.region, w.country,
      (CASE
        WHEN q.np IS NULL OR q.np = ''
          THEN similarity(coalesce(w.norm_name, ''), coalesce(q.nn, ''))
        ELSE 0.7 * similarity(coalesce(w.norm_name, ''), coalesce(q.nn, ''))
           + 0.3 * similarity(coalesce(w.norm_producer, ''), coalesce(q.np, ''))
      END)::numeric AS score,
      row_number() OVER (PARTITION BY q.idx ORDER BY (CASE
        WHEN q.np IS NULL OR q.np = ''
          THEN similarity(coalesce(w.norm_name, ''), coalesce(q.nn, ''))
        ELSE 0.7 * similarity(coalesce(w.norm_name, ''), coalesce(q.nn, ''))
           + 0.3 * similarity(coalesce(w.norm_producer, ''), coalesce(q.np, ''))
      END) DESC) AS rn
    FROM q
    JOIN public.wines w ON true
  )
  SELECT idx, id, name, producer, region, country, score
  FROM scored WHERE rn = 1;
$$;

REVOKE ALL ON FUNCTION public.find_wine_matches(text[], text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_wine_matches(text[], text[]) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.find_wine_match(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.find_wine_match(text, text) TO authenticated, service_role;