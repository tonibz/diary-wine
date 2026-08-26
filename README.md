# My Wine Journal

Build a mobile-first web app called Wine Diary. It helps people who don't know much about wine keep a personal log of the wines they try, learn what they actually like, and eventually decide what to order in a restaurant.

STACK
React + Tailwind + shadcn/ui. Supabase for auth, database, file storage and edge functions. Email and password auth.

DESIGN
Warm and personal, like a notebook, not a shopping app. Primary colour deep wine red #722F37, secondary #8B3A3A, background off-white #FAF8F5, text near-black #1F1B1A. Serif headings, clean sans-serif body. Rounded cards, soft shadows, generous whitespace. Mobile-first with a bottom tab bar.

DATA MODEL

profiles: id (references auth.users), display_name, created_at

wines (shared catalogue, any signed-in user can add to it):
id, name, producer, appellation, region, country, vintage (int, nullable), wine_type (red/white/rose/sparkling/dessert/fortified), grapes (text array), alcohol_percent (numeric, nullable), label_image_url, data_source ('label' | 'inferred' | 'user'), created_at

entries (the diary, one row per tasting):
id, user_id, wine_id, photo_url, rating (1-5), tasted_on (date, default today), place, company, notes, created_at

taste_profiles (one row per user, recalculated when their entries change):
user_id, type_split (jsonb), top_countries (jsonb), top_grapes (jsonb), avg_vintage_age (numeric), avg_alcohol (numeric), entry_count, updated_at

recognitions (analysis only, never shown in the UI):
id, user_id, entry_id (nullable), photo_path, model_name, raw_response (jsonb), confidence (numeric), corrected_fields (jsonb, nullable), created_at

Row level security: users read and write only their own entries, taste_profiles and recognitions. The wines table is readable by everyone and insertable by any signed-in user.

SCREENS

1. Auth. Sign up and log in.

2. My Diary (home tab). Reverse chronological list of logged wines. Each card shows the bottle photo, wine name, producer, vintage, star rating, and where and when it was tried. Search bar. Filters for wine type and minimum rating. Floating "+" button. Warm empty state when there is nothing yet.

3. Add a wine. Take or upload a photo, or skip straight to typing it in. Compress the image before upload: longest side max 1600px, JPEG around 85% quality. Upload to the wine-photos bucket, then call the recognise-label edge function and show a loading state saying "Reading the label...".
   - Confidence 0.6 or above: prefill the bottle form, data_source 'label'. Any field named in inferred_fields gets data_source 'inferred' plus a small subtle note in the UI saying it was worked out from the appellation rather than read off the label, so the user knows to check it.
   - Below 0.6, or any error: show the empty form with a plain message like "Couldn't read that one clearly, fill it in below", data_source 'user'.
   Never block the user. Every prefilled field stays editable.
   The form has two sections. The bottle: name, producer, appellation, region, country, vintage, wine type, grapes (multi-entry), alcohol percent. Only name is required. My tasting: star rating out of 5, date, place, who I was with, notes.
   Show a small hint like "6 of 9 bottle details filled in".

4. Wine detail. Everything known about the bottle plus the user's own tasting. Empty bottle fields show as subtle "add this" chips opening an inline editor. Edit and delete.

5. My Taste (tab). Built from the diary: one plain-language sentence summarising their taste, a donut of red vs white vs other, top 3 countries as bars, top 5 grapes as tags sized by frequency, average age and average alcohol. Only red and white feed these stats for now; other types still get logged and appear in the diary, say so quietly rather than hiding them. Under 5 entries, show an encouraging progress message instead of charts.

6. Settings. Display name, sign out.

EDGE FUNCTION: recognise-label
Needs a secret called ANTHROPIC_API_KEY. Prompt the user for it. Never expose it to the frontend.
Input: the storage path of a photo in the wine-photos bucket. Download the bytes, base64 encode, POST to https://api.anthropic.com/v1/messages with headers x-api-key, anthropic-version: 2023-06-01, content-type: application/json. Model "claude-sonnet-5", max_tokens 1000. One user message with an image content block then a text block containing:

"You are reading a photograph of a wine bottle label. Return ONLY a JSON object, with no prose and no markdown code fences.

Fields:
- name: the wine's name as printed
- producer: the winery or estate
- appellation: the denomination of origin, for example Corton-Charlemagne, Rioja, Chianti Classico
- region: the wider wine region
- country
- vintage: integer year, or null
- wine_type: one of red, white, rose, sparkling, dessert, fortified
- grapes: array of grape varieties
- alcohol_percent: number or null
- confidence: number from 0 to 1
- inferred_fields: array naming any field you filled in from knowledge of the appellation rather than reading it off the label

Rules. If something is not legible on the label, return null instead of guessing. Many European labels never print the colour or the grape, so you may infer those from the appellation, but you must list every field you inferred in inferred_fields. Set confidence low when the photo is blurred, badly lit, cropped, or the label is at a steep angle."

Parse the JSON. If parsing fails, return a clean error object rather than throwing.

RECOGNITION LOGGING
Write a recognitions row every time recognise-label runs, storing the full model response and confidence. When the user saves the entry, compare what they saved against what the model returned and write the differences into corrected_fields as {field: {model: ..., user: ...}}, and link the row via entry_id.

IMPORTANT
No shop, no public feed, no social following, no ratings from other users. This is a private personal log. Never invent wine data: if a field is unknown, leave it empty for the user to fill in.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://diary-wine.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/92172015-728e-4f95-80be-e71cc1e9346f).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
