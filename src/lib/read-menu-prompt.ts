export const MENU_PROMPT = `You are reading a photograph of a restaurant wine list. Return ONLY a JSON object with no prose and no markdown code fences.

Return: { "restaurant_name": string or null, "items": [ ... ] }

Each item: { "raw_text": the line exactly as printed, "name": the wine name, "producer": the winery or null, "vintage": integer or null, "price": number or null, "currency": three-letter code or null, "by_the_glass": true or false }

Rules. Include every wine you can read, even if some fields are missing. Wine lists are terse and often omit the producer. Do not invent producers or vintages that are not printed. Menus frequently group by region or style with headings such as Rioja or Champagne: use those headings to help identify the wines but do not return the headings as items. If a wine is listed at both glass and bottle prices, return the bottle price and set by_the_glass true. If the photo is unreadable, return an empty items array.`;
