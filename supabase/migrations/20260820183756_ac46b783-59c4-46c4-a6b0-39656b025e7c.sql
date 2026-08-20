-- 1. Audit attribution: require rows be attributed to the signed-in user
DROP POLICY IF EXISTS "wine_edits insertable by signed-in" ON public.wine_edits;
CREATE POLICY "wine_edits insertable by self"
  ON public.wine_edits FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "aliases insertable by signed-in" ON public.wine_aliases;
CREATE POLICY "aliases insertable by self"
  ON public.wine_aliases FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

-- 2. Shared catalogue writes: only the original contributor may change existing
--    values; everyone else may only fill fields that are currently empty.
CREATE OR REPLACE FUNCTION public.wines_guard_overwrite()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authorised to modify catalogue wines';
  END IF;

  -- Original contributor keeps full edit rights over their own wine.
  IF OLD.created_by IS NOT NULL AND OLD.created_by = uid THEN
    RETURN NEW;
  END IF;

  -- Identity columns can never be reassigned by others.
  NEW.created_by := OLD.created_by;
  NEW.data_source := OLD.data_source;

  -- Other users may only fill in blanks, never change or clear existing values.
  IF OLD.name IS NOT NULL AND btrim(OLD.name) <> '' AND NEW.name IS DISTINCT FROM OLD.name THEN
    NEW.name := OLD.name;
  END IF;
  IF OLD.producer IS NOT NULL AND btrim(OLD.producer) <> '' THEN NEW.producer := OLD.producer; END IF;
  IF OLD.appellation IS NOT NULL AND btrim(OLD.appellation) <> '' THEN NEW.appellation := OLD.appellation; END IF;
  IF OLD.region IS NOT NULL AND btrim(OLD.region) <> '' THEN NEW.region := OLD.region; END IF;
  IF OLD.country IS NOT NULL AND btrim(OLD.country) <> '' THEN NEW.country := OLD.country; END IF;
  IF OLD.wine_type IS NOT NULL THEN NEW.wine_type := OLD.wine_type; END IF;
  IF OLD.grapes IS NOT NULL AND array_length(OLD.grapes, 1) > 0 THEN NEW.grapes := OLD.grapes; END IF;
  IF OLD.label_image_url IS NOT NULL AND btrim(OLD.label_image_url) <> '' THEN
    NEW.label_image_url := OLD.label_image_url;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS wines_guard_overwrite_trg ON public.wines;
CREATE TRIGGER wines_guard_overwrite_trg
  BEFORE UPDATE ON public.wines
  FOR EACH ROW EXECUTE FUNCTION public.wines_guard_overwrite();

CREATE OR REPLACE FUNCTION public.wine_vintages_guard_overwrite()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  uid uuid := auth.uid();
  owner uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authorised to modify catalogue vintages';
  END IF;

  SELECT w.created_by INTO owner FROM public.wines w WHERE w.id = OLD.wine_id;
  IF owner IS NOT NULL AND owner = uid THEN
    RETURN NEW;
  END IF;

  -- Vintages cannot be re-pointed to another wine by other users.
  NEW.wine_id := OLD.wine_id;
  IF OLD.vintage IS NOT NULL THEN NEW.vintage := OLD.vintage; END IF;
  IF OLD.alcohol_percent IS NOT NULL THEN NEW.alcohol_percent := OLD.alcohol_percent; END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS wine_vintages_guard_overwrite_trg ON public.wine_vintages;
CREATE TRIGGER wine_vintages_guard_overwrite_trg
  BEFORE UPDATE ON public.wine_vintages
  FOR EACH ROW EXECUTE FUNCTION public.wine_vintages_guard_overwrite();