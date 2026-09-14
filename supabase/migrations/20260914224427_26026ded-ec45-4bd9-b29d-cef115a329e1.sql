CREATE OR REPLACE FUNCTION public.wines_guard_overwrite()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
BEGIN
  -- Trusted server-side maintenance (account deletion, backfills) is allowed.
  IF current_user IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

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
$function$;