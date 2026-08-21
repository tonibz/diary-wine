CREATE TABLE public.recommendations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  menu_scan_id uuid NOT NULL REFERENCES public.menu_scans(id) ON DELETE CASCADE,
  menu_item_id uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  score numeric NOT NULL DEFAULT 0,
  reason text,
  rank integer,
  profile_entry_count integer NOT NULL DEFAULT 0,
  acted_on boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.recommendations TO authenticated;
GRANT ALL ON public.recommendations TO service_role;

ALTER TABLE public.recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own recommendations" ON public.recommendations
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX recommendations_user_scan_idx ON public.recommendations (user_id, menu_scan_id);
CREATE UNIQUE INDEX recommendations_item_unique_idx ON public.recommendations (menu_item_id);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_recommendations_updated_at
  BEFORE UPDATE ON public.recommendations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Batched appellation lookup: one round trip for a whole wine list.
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
  ), scored AS (
    SELECT q.idx, a.id, a.name, a.country, a.region, a.typical_colour, a.grapes, a.grape_count,
      (CASE WHEN a.norm_name = q.nn THEN 1
            ELSE similarity(a.norm_name, coalesce(q.nn, '')) END)::numeric AS score,
      row_number() OVER (PARTITION BY q.idx ORDER BY (CASE WHEN a.norm_name = q.nn THEN 1
            ELSE similarity(a.norm_name, coalesce(q.nn, '')) END) DESC) AS rn
    FROM q
    JOIN public.appellations a ON true
    WHERE q.nn IS NOT NULL AND q.nn <> ''
  )
  SELECT idx, id, name, country, region, typical_colour, grapes, grape_count, score
  FROM scored WHERE rn = 1;
$function$;