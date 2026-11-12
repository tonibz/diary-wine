ALTER TABLE public.match_decisions
  ADD COLUMN sim_model_version text,
  ADD COLUMN sim_model_prob numeric,
  ADD COLUMN sim_orb_inliers integer,
  ADD COLUMN sim_text_name numeric,
  ADD COLUMN sim_text_producer numeric,
  ADD COLUMN sim_ms integer;
-- Existing authenticated ALL policy "own match decisions" already scopes both
-- USING and WITH CHECK to user_id = auth.uid(), including UPDATE.
GRANT UPDATE ON public.match_decisions TO authenticated;