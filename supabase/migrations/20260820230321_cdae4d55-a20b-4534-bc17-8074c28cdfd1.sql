ALTER TYPE public.match_decision_kind ADD VALUE IF NOT EXISTS 'auto_merge_visual';
ALTER TYPE public.match_decision_kind ADD VALUE IF NOT EXISTS 'auto_new_visual';

ALTER TABLE public.match_decisions
  ADD COLUMN IF NOT EXISTS visual_same_wine boolean,
  ADD COLUMN IF NOT EXISTS visual_confidence numeric,
  ADD COLUMN IF NOT EXISTS visual_reason text;