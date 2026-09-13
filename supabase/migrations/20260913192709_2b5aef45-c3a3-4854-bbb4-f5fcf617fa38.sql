ALTER TYPE public.match_decision_kind ADD VALUE IF NOT EXISTS 'auto_new_no_photo';

CREATE POLICY "wine-photos read catalogue labels"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'wine-photos'
  AND EXISTS (
    SELECT 1 FROM public.wines w
    WHERE w.label_image_url = storage.objects.name
  )
);