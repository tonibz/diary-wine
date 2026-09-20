CREATE TABLE public.recognition_cache (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  image_hash text NOT NULL,
  back_image_hash text,
  model_name text NOT NULL,
  prompt_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  hit_count integer NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX recognition_cache_key_idx
  ON public.recognition_cache (image_hash, coalesce(back_image_hash, ''), model_name, prompt_hash);

GRANT SELECT ON public.recognition_cache TO authenticated;
GRANT ALL ON public.recognition_cache TO service_role;

ALTER TABLE public.recognition_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recognition cache readable to signed-in"
  ON public.recognition_cache FOR SELECT TO authenticated USING (true);

ALTER TABLE public.recognitions ADD COLUMN cache_hit boolean NOT NULL DEFAULT false;