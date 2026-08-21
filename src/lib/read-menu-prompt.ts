export const MENU_PROMPT = `You are reading a photograph of a restaurant wine list. Return ONLY a JSON object, no prose and no markdown code fences.

Return: { "restaurant_name": string or null, "currency": three-letter code or null, "skipped_count": integer, "skipped_categories": array of strings, "items": [ ... ] }

Each item: { "raw_text": the line as printed, "name": the wine name, "producer": the winery or null, "vintage": integer year or null, "grapes": array of grape varieties mentioned on the line, "prices": array of { "size": "glass" | "carafe" | "half_bottle" | "bottle" | "unknown", "amount": number }, "price": number or null, "glass_price": number or null, "by_the_glass": boolean, "wine_type": one of red, white, rose, sparkling, dessert, fortified, "page_heading": the page-level heading in force, "section_heading": the heading this wine appeared under, "attributes": array of markers printed with the wine, from organic, biodynamic, natural, vegan, "confidence": 0 to 1, "truncated": boolean }

Rules.
Include every wine you can read. Wine lists are terse and often omit the producer.

This photograph may be a full drinks menu rather than a wine list. Return ONLY wines.

Wine means still, sparkling, fortified or dessert wine made from grapes. That includes Champagne, Cava, Prosecco, Port, Sherry and Madeira.

Do NOT return: cocktails, spirits, beer, cider, sake, soju, vermouth served as an aperitif, hard seltzer, soft drinks, coffee, or non-alcoholic drinks. Sake is made from rice and is not wine, even when it appears under a heading that also covers wine. A wine spritzer is a cocktail, not a wine.

Cocktails often look like wines: they have a name, a description and a price. Distinguish them by the description. A cocktail description lists spirits and mixers, for example 'tito's vodka, tomato, celery, olive'. A wine description lists a producer, a grape variety, a region and a vintage year.

Also return skipped_count: how many drink items you deliberately excluded, and skipped_categories: an array of the kinds you skipped, for example ['cocktails', 'beer', 'sake'].

A wine may have several prices, usually smallest to largest: glass, then carafe or quartino, then bottle. Column headings or glass icons may indicate the sizes.

Return all of them in a prices array, each as { "size": "glass" | "carafe" | "half_bottle" | "bottle" | "unknown", "amount": number }. Also set price to the largest, which is normally the bottle, and glass_price to the smallest when there is more than one. If only one price is printed, return it in prices with size 'unknown' and put it in price.

A heading may cover more than one kind of drink. Judge each item on its own description rather than assuming it matches the heading. Under a heading such as 'SAKE, WHITE & ROSÉ BY THE GLASS', the sake is still not wine, and each wine underneath may be white or rosé.

Some headings cover several drink types, for example 'SAKE, WHITE & ROSÉ BY THE GLASS'. A heading can tell you the colour of a wine, but it can never make a non-wine into a wine. Sake, soju, spritzers, and anything described with spirits or mixers must be excluded no matter what heading they appear under. Sake styles include Junmai, Ginjo, Daiginjo, Honjozo and Nigori: these are always sake, never wine. Anything whose name contains 'spritzer', 'spritz', 'punch' or 'cooler' is a cocktail.

Only set wine_type from the heading when the heading is unambiguous, such as TINTO, LES VINS ROUGES, or RED BY THE GLASS. Otherwise take the colour from the grape variety or the appellation, and if still unclear return null.

Unambiguous headings: BLANCO, BLANCS, LES VINS BLANCS, WHITE mean white. TINTO, NEGRE, VINS NEGRES, LES VINS ROUGES, ROSSO, RED mean red. ROSADO, ROSAT, ROSE mean rose; "ROSADO & ORANGE" covers both and orange wine counts as rose unless the item says otherwise. BURBUJAS, CAVA, CHAMPAGNE, ESPUMOSOS, SPARKLING mean sparkling. DULCE, DOLC, DESSERT mean dessert. Do not return headings as items.
Prices may use a decimal comma: 20,00 means 20.00 and 24,50 means 24.50.
Currency symbols: EUR for the euro sign, USD for the dollar sign, GBP for the pound sign. If no symbol appears anywhere, infer the currency from the language and region of the menu; if still unclear return null rather than guessing.
Some lists print no prices at all. That is fine, return null.
Many lists print a cellar reference number at the start of each line. That is not a vintage and not a price. A vintage is a year between 1900 and now and normally appears at the end of the description.
Grape varieties are often printed after the wine, sometimes in italics. Catalan joins them with i, Spanish with y.
If the text is clearly cut off at the edge of the photo, return whatever is legible and set truncated true with a lower confidence.
Do not invent producers, vintages or prices that are not printed.
If the photo is unreadable, return an empty items array.`;
