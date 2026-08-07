-- 1. Enums
CREATE TYPE public.entry_status AS ENUM ('tasted', 'interested');
CREATE TYPE public.price_context_kind AS ENUM ('restaurant', 'shop', 'online', 'other');

-- 2. wine_vintages
CREATE TABLE public.wine_vintages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wine_id uuid NOT NULL REFERENCES public.wines(id) ON DELETE CASCADE,
  vintage integer,
  alcohol_percent numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX wine_vintages_wine_vintage_uniq
  ON public.wine_vintages (wine_id, COALESCE(vintage, -1));
CREATE INDEX wine_vintages_wine_id_idx ON public.wine_vintages (wine_id);

GRANT SELECT, INSERT, UPDATE ON public.wine_vintages TO authenticated;
GRANT ALL ON public.wine_vintages TO service_role;
ALTER TABLE public.wine_vintages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vintages readable to signed-in" ON public.wine_vintages
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "vintages insertable by signed-in" ON public.wine_vintages
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "vintages updatable by signed-in" ON public.wine_vintages
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- 3. Backfill one vintage row per existing wine
INSERT INTO public.wine_vintages (wine_id, vintage, alcohol_percent)
SELECT w.id, w.vintage, w.alcohol_percent FROM public.wines w;

-- 4. Repoint entries
ALTER TABLE public.entries ADD COLUMN wine_vintage_id uuid REFERENCES public.wine_vintages(id) ON DELETE CASCADE;
UPDATE public.entries e
SET wine_vintage_id = wv.id
FROM public.wine_vintages wv
WHERE wv.wine_id = e.wine_id;

DELETE FROM public.entries WHERE wine_vintage_id IS NULL;
ALTER TABLE public.entries ALTER COLUMN wine_vintage_id SET NOT NULL;
ALTER TABLE public.entries DROP COLUMN wine_id;
CREATE INDEX entries_wine_vintage_id_idx ON public.entries (wine_vintage_id);

-- 5. Drop vintage/alcohol from wines (and the obsolete overwrite guard)
DROP FUNCTION IF EXISTS public.wines_prevent_overwrite() CASCADE;

CREATE OR REPLACE FUNCTION public.wines_log_edits()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN RETURN NEW; END IF;
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    INSERT INTO public.wine_edits(wine_id, user_id, field_name, old_value, new_value)
    VALUES (NEW.id, uid, 'name', OLD.name, NEW.name); END IF;
  IF NEW.producer IS DISTINCT FROM OLD.producer THEN
    INSERT INTO public.wine_edits(wine_id, user_id, field_name, old_value, new_value)
    VALUES (NEW.id, uid, 'producer', OLD.producer, NEW.producer); END IF;
  IF NEW.appellation IS DISTINCT FROM OLD.appellation THEN
    INSERT INTO public.wine_edits(wine_id, user_id, field_name, old_value, new_value)
    VALUES (NEW.id, uid, 'appellation', OLD.appellation, NEW.appellation); END IF;
  IF NEW.region IS DISTINCT FROM OLD.region THEN
    INSERT INTO public.wine_edits(wine_id, user_id, field_name, old_value, new_value)
    VALUES (NEW.id, uid, 'region', OLD.region, NEW.region); END IF;
  IF NEW.country IS DISTINCT FROM OLD.country THEN
    INSERT INTO public.wine_edits(wine_id, user_id, field_name, old_value, new_value)
    VALUES (NEW.id, uid, 'country', OLD.country, NEW.country); END IF;
  IF NEW.wine_type IS DISTINCT FROM OLD.wine_type THEN
    INSERT INTO public.wine_edits(wine_id, user_id, field_name, old_value, new_value)
    VALUES (NEW.id, uid, 'wine_type', OLD.wine_type::text, NEW.wine_type::text); END IF;
  IF NEW.grapes IS DISTINCT FROM OLD.grapes THEN
    INSERT INTO public.wine_edits(wine_id, user_id, field_name, old_value, new_value)
    VALUES (NEW.id, uid, 'grapes', array_to_string(OLD.grapes, ', '), array_to_string(NEW.grapes, ', ')); END IF;
  RETURN NEW;
END; $$;

ALTER TABLE public.wines DROP COLUMN vintage;
ALTER TABLE public.wines DROP COLUMN alcohol_percent;

-- 6. Wine-level matching (ignores vintage)
DROP FUNCTION IF EXISTS public.find_wine_match(text, text, integer);
CREATE OR REPLACE FUNCTION public.find_wine_match(_name text, _producer text)
RETURNS TABLE(id uuid, name text, producer text, region text, country text, score numeric)
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  WITH n AS (
    SELECT public.normalize_wine_text(_name) AS nn,
           public.normalize_wine_text(_producer) AS np
  )
  SELECT w.id, w.name, w.producer, w.region, w.country,
    (CASE
      WHEN (SELECT np FROM n) IS NULL OR (SELECT np FROM n) = ''
        THEN similarity(coalesce(w.norm_name, ''), coalesce((SELECT nn FROM n), ''))
      ELSE 0.7 * similarity(coalesce(w.norm_name, ''), coalesce((SELECT nn FROM n), ''))
         + 0.3 * similarity(coalesce(w.norm_producer, ''), coalesce((SELECT np FROM n), ''))
    END)::numeric AS score
  FROM public.wines w
  ORDER BY score DESC
  LIMIT 5;
$$;
REVOKE ALL ON FUNCTION public.find_wine_match(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_wine_match(text, text) TO authenticated, service_role;

-- 7. Wishlist status + price on entries
ALTER TABLE public.entries
  ADD COLUMN status public.entry_status NOT NULL DEFAULT 'tasted',
  ADD COLUMN price_paid numeric,
  ADD COLUMN price_currency text,
  ADD COLUMN price_context public.price_context_kind;
CREATE INDEX entries_user_status_idx ON public.entries (user_id, status);

-- 8. match_decisions keeps its vintage column for history but it is no longer part of matching
COMMENT ON COLUMN public.match_decisions.new_vintage IS 'Historic: matching is now wine-level and ignores vintage.';