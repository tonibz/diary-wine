ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS page_heading text,
  ADD COLUMN IF NOT EXISTS serving_basis text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS attributes jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.menu_items
  ADD CONSTRAINT menu_items_serving_basis_check
  CHECK (serving_basis IN ('glass', 'bottle', 'half_bottle', 'magnum', 'unknown'));

CREATE INDEX IF NOT EXISTS menu_items_serving_basis_idx ON public.menu_items (serving_basis);