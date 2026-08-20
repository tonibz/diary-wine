ALTER TABLE public.menu_scans
  ADD COLUMN IF NOT EXISTS currency text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS venue_note text,
  ADD COLUMN IF NOT EXISTS scanned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

UPDATE public.menu_scans SET scanned_by = user_id WHERE scanned_by IS NULL;