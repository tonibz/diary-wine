CREATE TABLE public.inference_checks (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  recognition_id uuid NOT NULL REFERENCES public.recognitions(id) ON DELETE CASCADE,
  appellation_matched text,
  appellation_match_score numeric,
  field text NOT NULL,
  model_value jsonb,
  reference_value jsonb,
  agrees boolean,
  overlap_count numeric,
  reference_count numeric,
  user_resolved_to text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX inference_checks_recognition_idx ON public.inference_checks(recognition_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inference_checks TO authenticated;
GRANT ALL ON public.inference_checks TO service_role;

ALTER TABLE public.inference_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own inference checks select" ON public.inference_checks
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.recognitions r WHERE r.id = inference_checks.recognition_id AND r.user_id = auth.uid()));

CREATE POLICY "own inference checks insert" ON public.inference_checks
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.recognitions r WHERE r.id = inference_checks.recognition_id AND r.user_id = auth.uid()));

CREATE POLICY "own inference checks update" ON public.inference_checks
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.recognitions r WHERE r.id = inference_checks.recognition_id AND r.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.recognitions r WHERE r.id = inference_checks.recognition_id AND r.user_id = auth.uid()));

CREATE POLICY "own inference checks delete" ON public.inference_checks
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.recognitions r WHERE r.id = inference_checks.recognition_id AND r.user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS appellations_norm_name_trgm_idx ON public.appellations USING gin (norm_name gin_trgm_ops);

CREATE OR REPLACE FUNCTION public.lookup_appellation(_name text)
RETURNS TABLE(id uuid, name text, country text, region text, typical_colour text, grapes jsonb, grape_count integer, score numeric)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  WITH n AS (SELECT public.normalize_wine_text(_name) AS nn)
  SELECT a.id, a.name, a.country, a.region, a.typical_colour, a.grapes, a.grape_count,
         (CASE WHEN a.norm_name = (SELECT nn FROM n) THEN 1
               ELSE similarity(a.norm_name, coalesce((SELECT nn FROM n), '')) END)::numeric AS score
  FROM public.appellations a
  WHERE (SELECT nn FROM n) IS NOT NULL AND (SELECT nn FROM n) <> ''
  ORDER BY score DESC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_appellation(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.lookup_appellation(text) FROM anon;