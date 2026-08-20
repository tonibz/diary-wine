ALTER TABLE public.menu_scans
  ADD COLUMN IF NOT EXISTS skipped_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS skipped_categories jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS prices jsonb,
  ADD COLUMN IF NOT EXISTS rejected boolean NOT NULL DEFAULT false;