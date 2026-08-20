export const COMPARE_LABELS_PROMPT = `You are shown two photographs of wine bottle labels. Decide whether they are the same wine.

Return ONLY JSON: { "same_wine": true or false or null, "same_producer": true or false or null, "confidence": 0 to 1, "reason": one short sentence }

What counts as the same wine: same producer and same wine name, even if the vintage year differs, even if the photos are at different angles or in different lighting, and even if the label was redesigned between vintages. Focus on the producer name, the wine name and the overall design identity.

What counts as different: a different producer, or a different wine from the same producer, for example a different cuvée, a different vineyard, or a different quality level such as Riserva versus the standard bottling.

Be careful with wines named after their region. Many estates make a wine called Brunello di Montalcino, Chablis or Chianti Classico. For those the producer name is what distinguishes them, not the large text on the label.

Return null for same_wine if either photo is too unclear to judge, and set confidence low.`;
