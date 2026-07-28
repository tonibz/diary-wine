
-- Extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Normalization function
CREATE OR REPLACE FUNCTION public.normalize_wine_text(t text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
  SELECT NULLIF(
    trim(regexp_replace(
      regexp_replace(
        regexp_replace(
          lower(public.unaccent(coalesce(t, ''))),
          '\y(domaine|chateau|bodega|bodegas|celler|cellar|cellier|tenuta|weingut|quinta|pere et fils|e figli|grand vin|mis en bouteille|produce of france|produit de france)\y',
          ' ', 'g'
        ),
        '[^a-z0-9 ]+', ' ', 'g'
      ),
      '\s+', ' ', 'g'
    )),
  '');
$$;

-- Add normalized columns
ALTER TABLE public.wines ADD COLUMN IF NOT EXISTS norm_name text;
ALTER TABLE public.wines ADD COLUMN IF NOT EXISTS norm_producer text;

-- Trigger to keep them in sync
CREATE OR REPLACE FUNCTION public.wines_set_norm()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.norm_name := public.normalize_wine_text(NEW.name);
  NEW.norm_producer := public.normalize_wine_text(NEW.producer);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS wines_set_norm_trg ON public.wines;
CREATE TRIGGER wines_set_norm_trg
BEFORE INSERT OR UPDATE OF name, producer ON public.wines
FOR EACH ROW EXECUTE FUNCTION public.wines_set_norm();

-- Backfill existing rows
UPDATE public.wines
SET norm_name = public.normalize_wine_text(name),
    norm_producer = public.normalize_wine_text(producer);

-- Trigram indexes
CREATE INDEX IF NOT EXISTS wines_norm_name_trgm ON public.wines USING gin (norm_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS wines_norm_producer_trgm ON public.wines USING gin (norm_producer gin_trgm_ops);

-- Find match function
CREATE OR REPLACE FUNCTION public.find_wine_match(_name text, _producer text, _vintage int)
RETURNS TABLE(id uuid, name text, producer text, region text, country text, vintage int, score numeric)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH n AS (
    SELECT public.normalize_wine_text(_name) AS nn,
           public.normalize_wine_text(_producer) AS np
  )
  SELECT w.id, w.name, w.producer, w.region, w.country, w.vintage,
    (CASE
      WHEN (SELECT np FROM n) IS NULL OR (SELECT np FROM n) = ''
        THEN similarity(coalesce(w.norm_name, ''), coalesce((SELECT nn FROM n), ''))
      ELSE 0.7 * similarity(coalesce(w.norm_name, ''), coalesce((SELECT nn FROM n), ''))
         + 0.3 * similarity(coalesce(w.norm_producer, ''), coalesce((SELECT np FROM n), ''))
    END)::numeric AS score
  FROM public.wines w
  WHERE w.vintage IS NOT DISTINCT FROM _vintage
  ORDER BY score DESC
  LIMIT 5;
$$;

GRANT EXECUTE ON FUNCTION public.find_wine_match(text, text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_wine_text(text) TO authenticated;

-- wine_aliases
CREATE TABLE public.wine_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wine_id uuid NOT NULL REFERENCES public.wines(id) ON DELETE CASCADE,
  raw_name text NOT NULL,
  raw_producer text,
  source public.wine_data_source NOT NULL DEFAULT 'user',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.wine_aliases TO authenticated;
GRANT ALL ON public.wine_aliases TO service_role;
ALTER TABLE public.wine_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "aliases readable to signed-in" ON public.wine_aliases
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "aliases insertable by signed-in" ON public.wine_aliases
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE INDEX wine_aliases_wine_id_idx ON public.wine_aliases(wine_id);

-- match_decisions
CREATE TYPE public.match_decision_kind AS ENUM ('auto_merge','user_merge','user_rejected','auto_new');

CREATE TABLE public.match_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  new_name text NOT NULL,
  new_producer text,
  new_vintage int,
  candidate_wine_id uuid REFERENCES public.wines(id) ON DELETE SET NULL,
  similarity_score numeric,
  decision public.match_decision_kind NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.match_decisions TO authenticated;
GRANT ALL ON public.match_decisions TO service_role;
ALTER TABLE public.match_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own match decisions" ON public.match_decisions
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
