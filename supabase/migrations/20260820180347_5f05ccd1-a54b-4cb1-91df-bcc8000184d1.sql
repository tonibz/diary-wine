CREATE TABLE IF NOT EXISTS public.menu_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  photo_path text,
  restaurant_name text,
  scanned_at timestamptz NOT NULL DEFAULT now(),
  raw_response jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.menu_scans TO authenticated;
GRANT ALL ON public.menu_scans TO service_role;
ALTER TABLE public.menu_scans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own menu scans" ON public.menu_scans FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.menu_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_scan_id uuid NOT NULL REFERENCES public.menu_scans(id) ON DELETE CASCADE,
  raw_text text,
  parsed_name text,
  parsed_producer text,
  parsed_vintage integer,
  price numeric,
  glass_price numeric,
  currency text,
  by_the_glass boolean NOT NULL DEFAULT false,
  section_heading text,
  wine_type text,
  grapes jsonb,
  item_confidence numeric,
  truncated boolean NOT NULL DEFAULT false,
  matched_wine_id uuid REFERENCES public.wines(id),
  match_score numeric,
  position integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS menu_items_scan_idx ON public.menu_items (menu_scan_id, position);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.menu_items TO authenticated;
GRANT ALL ON public.menu_items TO service_role;
ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own menu items" ON public.menu_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.menu_scans s WHERE s.id = menu_items.menu_scan_id AND s.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.menu_scans s WHERE s.id = menu_items.menu_scan_id AND s.user_id = auth.uid()));