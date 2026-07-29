
-- 1. Storage: only the uploader can read their own wine photos
DROP POLICY IF EXISTS "wine-photos read for signed-in" ON storage.objects;
CREATE POLICY "wine-photos read own"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'wine-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

-- 2. Wines: any signed-in user can fill empty fields; a trigger prevents overwrites
DROP POLICY IF EXISTS "wines update own contributions" ON public.wines;
CREATE POLICY "wines update fill empty"
ON public.wines FOR UPDATE TO authenticated
USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE OR REPLACE FUNCTION public.wines_prevent_overwrite()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  -- Preserve existing non-null values; only allow filling from NULL.
  NEW.name := COALESCE(OLD.name, NEW.name);
  NEW.producer := COALESCE(OLD.producer, NEW.producer);
  NEW.appellation := COALESCE(OLD.appellation, NEW.appellation);
  NEW.region := COALESCE(OLD.region, NEW.region);
  NEW.country := COALESCE(OLD.country, NEW.country);
  NEW.vintage := COALESCE(OLD.vintage, NEW.vintage);
  NEW.wine_type := COALESCE(OLD.wine_type, NEW.wine_type);
  IF OLD.grapes IS NOT NULL AND array_length(OLD.grapes, 1) > 0 THEN
    NEW.grapes := OLD.grapes;
  END IF;
  NEW.alcohol_percent := COALESCE(OLD.alcohol_percent, NEW.alcohol_percent);
  NEW.label_image_url := COALESCE(OLD.label_image_url, NEW.label_image_url);
  NEW.created_by := OLD.created_by;
  NEW.created_at := OLD.created_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS wines_prevent_overwrite ON public.wines;
CREATE TRIGGER wines_prevent_overwrite
BEFORE UPDATE ON public.wines
FOR EACH ROW EXECUTE FUNCTION public.wines_prevent_overwrite();

-- 3. Privacy: strip personal photos from the shared catalogue
UPDATE public.wines SET label_image_url = NULL WHERE label_image_url IS NOT NULL;
