
-- 1. Drop the overwrite-prevention trigger so users can edit shared wines
DROP TRIGGER IF EXISTS wines_prevent_overwrite_trg ON public.wines;
DROP TRIGGER IF EXISTS trg_wines_prevent_overwrite ON public.wines;
-- catch any name
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.wines'::regclass AND NOT tgisinternal AND tgname ILIKE '%prevent_overwrite%'
  LOOP
    EXECUTE format('DROP TRIGGER %I ON public.wines', t.tgname);
  END LOOP;
END $$;

-- 2. wine_edits audit log
CREATE TABLE IF NOT EXISTS public.wine_edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wine_id uuid NOT NULL REFERENCES public.wines(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  field_name text NOT NULL,
  old_value text,
  new_value text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.wine_edits TO authenticated;
GRANT ALL ON public.wine_edits TO service_role;

ALTER TABLE public.wine_edits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wine_edits readable to signed-in" ON public.wine_edits
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "wine_edits insertable by signed-in" ON public.wine_edits
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

-- 3. Trigger that logs every field change on wines
CREATE OR REPLACE FUNCTION public.wines_log_edits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.name IS DISTINCT FROM OLD.name THEN
    INSERT INTO public.wine_edits(wine_id, user_id, field_name, old_value, new_value)
    VALUES (NEW.id, uid, 'name', OLD.name, NEW.name);
  END IF;
  IF NEW.producer IS DISTINCT FROM OLD.producer THEN
    INSERT INTO public.wine_edits(wine_id, user_id, field_name, old_value, new_value)
    VALUES (NEW.id, uid, 'producer', OLD.producer, NEW.producer);
  END IF;
  IF NEW.appellation IS DISTINCT FROM OLD.appellation THEN
    INSERT INTO public.wine_edits(wine_id, user_id, field_name, old_value, new_value)
    VALUES (NEW.id, uid, 'appellation', OLD.appellation, NEW.appellation);
  END IF;
  IF NEW.region IS DISTINCT FROM OLD.region THEN
    INSERT INTO public.wine_edits(wine_id, user_id, field_name, old_value, new_value)
    VALUES (NEW.id, uid, 'region', OLD.region, NEW.region);
  END IF;
  IF NEW.country IS DISTINCT FROM OLD.country THEN
    INSERT INTO public.wine_edits(wine_id, user_id, field_name, old_value, new_value)
    VALUES (NEW.id, uid, 'country', OLD.country, NEW.country);
  END IF;
  IF NEW.vintage IS DISTINCT FROM OLD.vintage THEN
    INSERT INTO public.wine_edits(wine_id, user_id, field_name, old_value, new_value)
    VALUES (NEW.id, uid, 'vintage', OLD.vintage::text, NEW.vintage::text);
  END IF;
  IF NEW.wine_type IS DISTINCT FROM OLD.wine_type THEN
    INSERT INTO public.wine_edits(wine_id, user_id, field_name, old_value, new_value)
    VALUES (NEW.id, uid, 'wine_type', OLD.wine_type::text, NEW.wine_type::text);
  END IF;
  IF NEW.grapes IS DISTINCT FROM OLD.grapes THEN
    INSERT INTO public.wine_edits(wine_id, user_id, field_name, old_value, new_value)
    VALUES (NEW.id, uid, 'grapes',
      array_to_string(OLD.grapes, ', '),
      array_to_string(NEW.grapes, ', '));
  END IF;
  IF NEW.alcohol_percent IS DISTINCT FROM OLD.alcohol_percent THEN
    INSERT INTO public.wine_edits(wine_id, user_id, field_name, old_value, new_value)
    VALUES (NEW.id, uid, 'alcohol_percent', OLD.alcohol_percent::text, NEW.alcohol_percent::text);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS wines_log_edits_trg ON public.wines;
CREATE TRIGGER wines_log_edits_trg
  AFTER UPDATE ON public.wines
  FOR EACH ROW EXECUTE FUNCTION public.wines_log_edits();

-- 4. Back-label photo on entries
ALTER TABLE public.entries
  ADD COLUMN IF NOT EXISTS back_photo_url text;

-- 5. Opt-in GPS reverse-geocode toggle
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS gps_lookup_enabled boolean NOT NULL DEFAULT false;
