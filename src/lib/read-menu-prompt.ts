export const MENU_PROMPT = `You are reading a photograph of a restaurant wine list. Return ONLY a JSON object, no prose and no markdown code fences.

Return: { "restaurant_name": string or null, "currency": three-letter code or null, "items": [ ... ] }

Each item: { "raw_text": the line as printed, "name": the wine name, "producer": the winery or null, "vintage": integer year or null, "grapes": array of grape varieties mentioned on the line, "price": bottle price as a number or null, "glass_price": number or null, "by_the_glass": boolean, "wine_type": one of red, white, rose, sparkling, dessert, fortified, "section_heading": the heading this wine appeared under, "confidence": 0 to 1, "truncated": boolean }

Rules.
Include every wine you can read. Wine lists are terse and often omit the producer.
Set wine_type from the section heading above the wine. BLANCO, BLANCS, LES VINS BLANCS, WHITE mean white. TINTO, NEGRE, VINS NEGRES, LES VINS ROUGES, ROSSO, RED mean red. ROSADO, ROSAT, ROSE mean rose; "ROSADO & ORANGE" covers both and orange wine counts as rose unless the item says otherwise. BURBUJAS, CAVA, CHAMPAGNE, ESPUMOSOS, SPARKLING mean sparkling. DULCE, DOLC, DESSERT mean dessert. Do not return headings as items.
Prices may use a decimal comma: 20,00 means 20.00 and 24,50 means 24.50.
Two prices on one line means bottle then glass: put the bottle price in price and the glass price in glass_price, and set by_the_glass true when a glass price exists.
Currency symbols: EUR for the euro sign, USD for the dollar sign, GBP for the pound sign. If no symbol appears anywhere, infer the currency from the language and region of the menu; if still unclear return null rather than guessing.
Some lists print no prices at all. That is fine, return null.
Many lists print a cellar reference number at the start of each line. That is not a vintage and not a price. A vintage is a year between 1900 and now and normally appears at the end of the description.
Grape varieties are often printed after the wine, sometimes in italics. Catalan joins them with i, Spanish with y.
If the text is clearly cut off at the edge of the photo, return whatever is legible and set truncated true with a lower confidence.
Do not invent producers, vintages or prices that are not printed.
If the photo is unreadable, return an empty items array.`;
