import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { PRIVACY, PRIVACY_CONTACT_EMAIL, PRIVACY_UPDATED } from "@/content/privacy";
import { useLanguage } from "@/lib/language";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Política de privacidad / Privacy Policy — Wine Diary" },
      { name: "description", content: PRIVACY.es.intro[0] },
      { property: "og:title", content: "Política de privacidad / Privacy Policy" },
      { property: "og:description", content: PRIVACY.es.intro[0] },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PrivacyPage,
});

/** Sustituye {{email}} por el correo de contacto, renderizado como mailto:. */
function Paragraph({ text }: { text: string }) {
  const parts = text.split("{{email}}");
  if (parts.length === 1) return <p>{text}</p>;
  return (
    <p>
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 && (
            <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`} className="text-primary underline underline-offset-4">
              {PRIVACY_CONTACT_EMAIL}
            </a>
          )}
        </span>
      ))}
    </p>
  );
}

function PrivacyPage() {
  const { language } = useLanguage();
  const content = PRIVACY[language] ?? PRIVACY.en;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-xl px-5 pt-8 pb-16">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft size={16} /> Wine Diary
        </Link>
        <h1 className="mt-6 text-4xl font-serif text-primary">{content.title}</h1>
        <p className="mt-2 text-xs text-muted-foreground">{content.updatedLabel}</p>
        <p className="sr-only">updated {PRIVACY_UPDATED}</p>

        <div className="mt-8 space-y-4 leading-relaxed text-foreground">
          {content.intro.map((p, i) => (
            <Paragraph key={i} text={p} />
          ))}
        </div>

        {content.sections.map((section, i) => (
          <section key={i} className="mt-10">
            <h2 className="font-serif text-2xl text-foreground">{section.heading}</h2>
            <div className="mt-3 space-y-4 leading-relaxed text-foreground">
              {section.paragraphs.map((p, j) => (
                <Paragraph key={j} text={p} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
