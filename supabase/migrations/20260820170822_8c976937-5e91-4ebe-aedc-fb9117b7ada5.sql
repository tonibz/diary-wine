ALTER TABLE public.wines ADD COLUMN IF NOT EXISTS field_sources jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.recognitions ADD COLUMN IF NOT EXISTS inferred_fields jsonb;
UPDATE public.wines SET data_source = 'label' WHERE data_source = 'inferred';