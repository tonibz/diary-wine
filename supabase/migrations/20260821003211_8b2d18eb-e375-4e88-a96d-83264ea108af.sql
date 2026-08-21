ALTER TABLE public.menu_scans
  ADD COLUMN IF NOT EXISTS superseded boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES public.menu_scans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS restaurant_unknown boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS menu_scans_user_recent_idx
  ON public.menu_scans (user_id, scanned_at DESC);