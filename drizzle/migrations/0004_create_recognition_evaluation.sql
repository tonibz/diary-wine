CREATE TABLE public.eval_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recognition_id uuid NOT NULL REFERENCES public.recognitions(id) ON DELETE CASCADE,
  condition text NOT NULL CHECK (condition IN ('A_current_front_back', 'B_current_front', 'C_strict_front')),
  model_name text NOT NULL,
  prompt_hash text NOT NULL,
  raw_response jsonb,
  parsed jsonb,
  error text,
  input_tokens int,
  output_tokens int,
  created_at timestamptz DEFAULT now(),
  UNIQUE (recognition_id, condition, prompt_hash)
);
GRANT SELECT, INSERT ON public.eval_runs TO authenticated;
GRANT ALL ON public.eval_runs TO service_role;
ALTER TABLE public.eval_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner can select eval runs" ON public.eval_runs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.recognitions r WHERE r.id = recognition_id AND r.user_id = auth.uid()));
CREATE POLICY "Owner can insert eval runs" ON public.eval_runs FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.recognitions r WHERE r.id = recognition_id AND r.user_id = auth.uid()));

CREATE TABLE public.eval_judgements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recognition_id uuid NOT NULL REFERENCES public.recognitions(id) ON DELETE CASCADE,
  judge_model text NOT NULL,
  prompt_hash text NOT NULL,
  raw_response jsonb,
  front jsonb,
  back jsonb,
  error text,
  input_tokens int,
  output_tokens int,
  created_at timestamptz DEFAULT now(),
  UNIQUE (recognition_id, judge_model, prompt_hash)
);
GRANT SELECT, INSERT ON public.eval_judgements TO authenticated;
GRANT ALL ON public.eval_judgements TO service_role;
ALTER TABLE public.eval_judgements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner can select eval judgements" ON public.eval_judgements FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.recognitions r WHERE r.id = recognition_id AND r.user_id = auth.uid()));
CREATE POLICY "Owner can insert eval judgements" ON public.eval_judgements FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.recognitions r WHERE r.id = recognition_id AND r.user_id = auth.uid()));

ALTER TABLE public.recognitions ADD COLUMN prompt_hash text;