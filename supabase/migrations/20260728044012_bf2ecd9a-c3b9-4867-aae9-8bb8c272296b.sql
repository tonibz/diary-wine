
-- wine type enum
CREATE TYPE public.wine_type AS ENUM ('red','white','rose','sparkling','dessert','fortified');
CREATE TYPE public.wine_data_source AS ENUM ('label','inferred','user');

-- profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile select" ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "own profile insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid());

-- wines (shared)
CREATE TABLE public.wines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  producer TEXT,
  appellation TEXT,
  region TEXT,
  country TEXT,
  vintage INT,
  wine_type public.wine_type,
  grapes TEXT[] DEFAULT '{}',
  alcohol_percent NUMERIC,
  label_image_url TEXT,
  data_source public.wine_data_source NOT NULL DEFAULT 'user',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.wines TO authenticated;
GRANT ALL ON public.wines TO service_role;
ALTER TABLE public.wines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wines readable to all signed-in" ON public.wines FOR SELECT TO authenticated USING (true);
CREATE POLICY "wines insert signed-in" ON public.wines FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "wines update own contributions" ON public.wines FOR UPDATE TO authenticated USING (created_by = auth.uid());

-- entries
CREATE TABLE public.entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wine_id UUID NOT NULL REFERENCES public.wines(id) ON DELETE RESTRICT,
  photo_url TEXT,
  rating INT CHECK (rating BETWEEN 1 AND 5),
  tasted_on DATE NOT NULL DEFAULT CURRENT_DATE,
  place TEXT,
  company TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.entries TO authenticated;
GRANT ALL ON public.entries TO service_role;
ALTER TABLE public.entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own entries all" ON public.entries FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- taste profiles
CREATE TABLE public.taste_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  type_split JSONB DEFAULT '{}'::jsonb,
  top_countries JSONB DEFAULT '[]'::jsonb,
  top_grapes JSONB DEFAULT '[]'::jsonb,
  avg_vintage_age NUMERIC,
  avg_alcohol NUMERIC,
  entry_count INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.taste_profiles TO authenticated;
GRANT ALL ON public.taste_profiles TO service_role;
ALTER TABLE public.taste_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own taste profile" ON public.taste_profiles FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- recognitions
CREATE TABLE public.recognitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entry_id UUID REFERENCES public.entries(id) ON DELETE SET NULL,
  photo_path TEXT NOT NULL,
  model_name TEXT,
  raw_response JSONB,
  confidence NUMERIC,
  corrected_fields JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recognitions TO authenticated;
GRANT ALL ON public.recognitions TO service_role;
ALTER TABLE public.recognitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own recognitions" ON public.recognitions FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- profile auto-creation trigger
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email,'@',1)));
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- indexes
CREATE INDEX entries_user_created_idx ON public.entries (user_id, created_at DESC);
CREATE INDEX entries_wine_idx ON public.entries (wine_id);
CREATE INDEX recognitions_user_idx ON public.recognitions (user_id, created_at DESC);
