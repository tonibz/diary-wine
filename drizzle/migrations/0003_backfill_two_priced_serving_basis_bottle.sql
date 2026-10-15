UPDATE public.menu_items
SET serving_basis = 'bottle'
WHERE rejected = false
  AND price IS NOT NULL
  AND glass_price IS NOT NULL
  AND serving_basis <> 'bottle';