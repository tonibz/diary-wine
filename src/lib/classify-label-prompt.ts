export const CLASSIFY_PROMPT = (count: number) => `You are sorting ${count} photographs of wine bottles. Each photo is either a FRONT label or a BACK label of a bottle.

A back label usually has: no large producer or wine name in display type, dense small print, a barcode, an alcohol percentage, a volume such as 75cl or 750ml, and phrases such as "contains sulfites", "contient des sulfites", "mis en bouteille", "importado por", "imported by", "product of", "produce of", government health warnings, or a recycling mark.

A front label carries the wine's name and producer prominently, often a crest, château drawing or brand mark, and the vintage.

Return ONLY a JSON object, no prose and no markdown fences, in this exact shape:
{"photos":[{"side":"front"|"back","reason":"short reason"}]}

The array must have exactly ${count} entries, in the same order as the photos were given.`;
