import type { LanguageCode } from "@/i18n/locales";

// TODO: sustituir por el correo real de contacto antes de publicar.
export const PRIVACY_CONTACT_EMAIL = "PENDIENTE@diary.wine";
export const PRIVACY_UPDATED = "2026-09-20";

export const PRIVACY: Record<
  LanguageCode,
  {
    title: string;
    updatedLabel: string;
    intro: string[];
    sections: { heading: string; paragraphs: string[] }[];
  }
> = {
  es: {
    title: "Política de privacidad",
    updatedLabel: "Última actualización: 20 de septiembre de 2026",
    intro: [
      "Wine Diary es un diario personal de vinos. Esta página explica qué guardamos, por qué, con quién se comparte y cómo borrarlo todo. Está escrita en lenguaje normal a propósito.",
      "Quién responde de tus datos: {{email}}.",
    ],
    sections: [
      {
        heading: "Qué guardamos",
        paragraphs: [
          "Tu cuenta. Tu correo, tu nombre si lo pones, y tu contraseña (cifrada, nunca la vemos). Si entras con Google o Apple, guardamos el correo y el nombre que nos den ellos; no recibimos tu contraseña.",
          "Tus catas. Todo lo que apuntas: vino, bodega, denominación, región, país, añada, tipo, uvas, alcohol, tu puntuación, tus notas, la fecha, el sitio donde lo bebiste, con quién estabas y lo que pagaste.",
          "Tus fotos. Las fotos de etiquetas y contraetiquetas que haces, y las fotos de cartas de vinos que escaneas.",
          "Tu perfil de gusto. Un resumen calculado a partir de tus catas puntuadas: qué colores, países y uvas repites. Sale de tus datos, no de ningún sitio externo.",
          "Datos técnicos mínimos. Cuando algo falla, registramos el error para poder arreglarlo: qué pantalla, qué mensaje de error, qué navegador. No enviamos tus fotos, tus notas ni el sitio donde bebiste.",
          "Ubicación: solo si tú la activas. Por defecto está desactivada. Si la activas en Ajustes, leemos las coordenadas GPS que tu propia foto lleva dentro para proponerte el nombre del sitio. Puedes desactivarla cuando quieras.",
        ],
      },
      {
        heading: "Qué hacemos con ello",
        paragraphs: [
          "Leer la etiqueta o la carta que fotografías y rellenar los campos por ti. Guardar tu diario y enseñártelo. Calcular tu perfil de gusto y sugerirte vinos de una carta. Detectar si un vino que acabas de escanear ya está en el catálogo. Arreglar fallos.",
          "No vendemos tus datos. No los cedemos a anunciantes. No hacemos publicidad dirigida.",
        ],
      },
      {
        heading: "Lo que ven otras personas",
        paragraphs: [
          "Wine Diary tiene dos capas, y la diferencia importa.",
          "Tu diario es privado. Tus catas, tus puntuaciones, tus notas, dónde bebiste, con quién y cuánto pagaste: eso no lo ve nadie más. Tus fotos de cartas de restaurante tampoco.",
          "El catálogo de vinos es compartido. Cuando escaneas una botella que nadie había apuntado antes, la identidad del vino (nombre, bodega, denominación, región, país, tipo, uvas) pasa a un catálogo común, para que la próxima persona que escanee esa misma botella no tenga que rellenarlo todo a mano.",
          "Tu foto de etiqueta puede acabar en ese catálogo. Si eres la primera persona que apunta un vino, tu foto de la etiqueta se guarda como foto de ese vino en el catálogo. Cuando otra persona escanee una botella parecida y la app le pregunte «¿es el mismo vino?», verá esa foto para poder compararla. Lo mismo al revés: tú ves fotos que han hecho otras personas.",
          "Lo que se comparte de esa foto es la etiqueta y nada más: no va tu nombre, ni tu puntuación, ni tu nota, ni dónde la bebiste. Aun así, haz las fotos pensando en eso: si en el encuadre sale tu salón, tu cara o la matrícula de tu coche, esa imagen puede llegar a verla otra persona.",
        ],
      },
      {
        heading: "Quién más toca tus datos",
        paragraphs: [
          "Trabajamos con tres proveedores y ninguno más.",
          "Anthropic (Claude). Tus fotos de etiquetas y de cartas se envían a la API de Claude para leerlas. Anthropic no usa los datos de la API para entrenar modelos y, en el modelo que usamos, no conserva el contenido una vez devuelta la respuesta.",
          "Supabase. Aloja la base de datos, el sistema de cuentas y las fotos.",
          "Sentry. Recibe los informes de error descritos arriba.",
          "Todos ellos actúan por cuenta nuestra y bajo contrato. Fuera de eso, solo entregaríamos datos si nos obligara la ley.",
        ],
      },
      {
        heading: "Cuánto tiempo",
        paragraphs: [
          "Mientras tengas la cuenta abierta. Cuando la borras, se va todo lo tuyo. Los informes de error se eliminan a los 90 días.",
        ],
      },
      {
        heading: "Lo que puedes hacer",
        paragraphs: [
          "Descargar tu diario. En Ajustes, «Descargar tu diario»: un CSV con todas tus catas.",
          "Corregir lo que sea. Cualquier campo de cualquier cata se edita desde la propia app.",
          "Borrar tu cuenta. En Ajustes, «Borrar tu cuenta». Es inmediato y no se puede deshacer. Se borran tus catas, tus cartas escaneadas, tus fotos, tu perfil de gusto y tu acceso.",
          "Dos matices sobre el borrado, para que no haya sorpresas. Los vinos que añadiste al catálogo compartido se quedan ahí, porque otras personas tienen catas enlazadas a ellos; tu nombre desaparece de ellos y quedan como vinos sin autor. Tus fotos sí se borran todas, incluidas las que se hubieran convertido en foto de catálogo de un vino, y ese vino se queda sin foto hasta que otra persona aporte la suya.",
          "Si vives en la UE, además tienes derecho de acceso, rectificación, supresión, limitación, oposición y portabilidad, y puedes reclamar ante tu autoridad de protección de datos. Escríbenos a {{email}} y te contestamos.",
        ],
      },
      {
        heading: "Menores",
        paragraphs: [
          "Wine Diary es para mayores de edad. No abras una cuenta si no tienes la edad legal para beber donde vives. Si nos enteramos de que una cuenta es de un menor, la borramos.",
        ],
      },
      {
        heading: "Cambios",
        paragraphs: [
          "Si cambiamos algo importante, lo verás dentro de la app antes de que te afecte, no solo aquí.",
        ],
      },
      {
        heading: "Contacto",
        paragraphs: ["{{email}}"],
      },
    ],
  },
  en: {
    title: "Privacy Policy",
    updatedLabel: "Last updated: 20 September 2026",
    intro: [
      "Wine Diary is a personal wine diary. This page explains what we keep, why, who else sees it, and how to delete all of it. It's deliberately written in plain language.",
      "Who's responsible for your data: {{email}}.",
    ],
    sections: [
      {
        heading: "What we keep",
        paragraphs: [
          "Your account. Your email, your name if you give one, and your password (encrypted — we never see it). If you sign in with Google or Apple, we keep the email and name they pass us; we never receive your password.",
          "Your tastings. Everything you note down: wine, producer, appellation, region, country, vintage, type, grapes, alcohol, your rating, your notes, the date, where you drank it, who you were with and what you paid.",
          "Your photos. The label and back-label photos you take, and the photos of wine lists you scan.",
          "Your taste profile. A summary worked out from your rated tastings: which colours, countries and grapes you keep coming back to. It comes from your own data, nowhere else.",
          "Minimal technical data. When something breaks, we log the error so we can fix it: which screen, which error message, which browser. We don't send your photos, your notes or where you were drinking.",
          "Location: only if you turn it on. It's off by default. If you turn it on in Settings, we read the GPS coordinates already inside your own photo to suggest the name of the place. You can turn it off whenever you like.",
        ],
      },
      {
        heading: "What we do with it",
        paragraphs: [
          "Read the label or wine list you photograph and fill in the fields for you. Store your diary and show it back to you. Work out your taste profile and suggest wines from a list. Spot whether a wine you've just scanned is already in the catalogue. Fix bugs.",
          "We don't sell your data. We don't pass it to advertisers. We don't run targeted ads.",
        ],
      },
      {
        heading: "What other people see",
        paragraphs: [
          "Wine Diary has two layers, and the difference matters.",
          "Your diary is private. Your tastings, your ratings, your notes, where you drank, who with and what you paid: nobody else sees any of it. Neither do your photos of restaurant wine lists.",
          "The wine catalogue is shared. When you scan a bottle nobody has logged before, the wine's identity (name, producer, appellation, region, country, type, grapes) goes into a shared catalogue, so the next person to scan that same bottle doesn't have to type it all in by hand.",
          "Your label photo may end up in that catalogue. If you're the first person to log a wine, your label photo is saved as that wine's catalogue photo. When someone else scans a similar bottle and the app asks them \"is this the same wine?\", they'll see that photo so they can compare. The same happens the other way round: you see photos other people took.",
          "What's shared from that photo is the label and nothing else — not your name, not your rating, not your note, not where you drank it. Even so, frame your photos with that in mind: if your living room, your face or your number plate is in the shot, someone else may end up looking at it.",
        ],
      },
      {
        heading: "Who else touches your data",
        paragraphs: [
          "We work with three providers and no others.",
          "Anthropic (Claude). Your label and wine-list photos are sent to the Claude API to be read. Anthropic doesn't use API data to train models, and for the model we use it doesn't retain the content once the response has been returned.",
          "Supabase. Hosts the database, the accounts system and the photos.",
          "Sentry. Receives the error reports described above.",
          "All of them act on our behalf and under contract. Beyond that, we'd only hand over data if the law required it.",
        ],
      },
      {
        heading: "How long",
        paragraphs: [
          "For as long as your account is open. When you delete it, everything of yours goes. Error reports are deleted after 90 days.",
        ],
      },
      {
        heading: "What you can do",
        paragraphs: [
          "Download your diary. In Settings, \"Download your diary\": a CSV with all your tastings.",
          "Correct anything. Any field of any tasting can be edited from inside the app.",
          "Delete your account. In Settings, \"Delete your account\". It's immediate and can't be undone. Your tastings, your menu scans, your photos, your taste profile and your login are all deleted.",
          "Two details about deletion, so there are no surprises. Wines you added to the shared catalogue stay there, because other people have tastings linked to them; your name is removed from them and they're left with no author. All your photos are deleted, including any that had become a wine's catalogue photo, and that wine is left with no photo until someone else contributes theirs.",
          "If you live in the EU, you also have rights of access, rectification, erasure, restriction, objection and portability, and you can complain to your data protection authority. Write to {{email}} and we'll get back to you.",
        ],
      },
      {
        heading: "Under-18s",
        paragraphs: [
          "Wine Diary is for adults. Don't open an account if you're not of legal drinking age where you live. If we find out an account belongs to a minor, we delete it.",
        ],
      },
      {
        heading: "Changes",
        paragraphs: [
          "If we change anything important, you'll see it inside the app before it affects you, not just here.",
        ],
      },
      {
        heading: "Contact",
        paragraphs: ["{{email}}"],
      },
    ],
  },
};
