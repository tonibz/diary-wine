
CREATE POLICY "wine-photos read for signed-in"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'wine-photos');

CREATE POLICY "wine-photos insert own folder"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'wine-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "wine-photos update own"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'wine-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "wine-photos delete own"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'wine-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
