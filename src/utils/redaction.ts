/**
 * Utilitaires d'expurgation automatique pour rapports et fiches SCP.
 */

const PLACE_NAMES =
  /\b(SITE-[\w█]+|Site-\d+|zone\s+\d+|niveau\s+[\w-]+|secteur\s+[\w-]+)\b/gi;
const NUMBERS = /\b(\d{1,4})\b/g;
const RESEARCHER = /\b(Dr\.?\s+[\w-]+|Chercheur\s+[\w-]+|Agent\s+[\w-]+)\b/gi;
const NEUTRALIZATION =
  /\b(procédure\s+de\s+neutralisation|neutralisation|contenant\s+par|méthode\s+de\s+confinement)[^.]*\./gi;

export function redactInstitutionalText(text: string, intensity = 0.35): string {
  if (!text || text.length < 20) return text;

  let out = text;
  out = out.replace(PLACE_NAMES, "████");
  out = out.replace(RESEARCHER, "[EXPURGÉ]");
  out = out.replace(NEUTRALIZATION, "[DONNÉES SUPPRIMÉES PAR ORDRE DU COMITÉ O5].");
  out = out.replace(NUMBERS, (n) => (Math.random() < intensity ? "██" : n));

  return out;
}

/** Découpe un paragraphe en segments texte / expurgé pour rendu React. */
export function splitForRedaction(
  paragraph: string,
): Array<{ type: "text" | "l1" | "l2" | "l3"; value: string }> {
  const sentences = paragraph.split(/(?<=[.!?])\s+/);
  const result: Array<{ type: "text" | "l1" | "l2" | "l3"; value: string }> = [];
  let redactedCount = 0;
  const target = Math.ceil(sentences.length * 0.35);

  for (const s of sentences) {
    if (!s.trim()) continue;
    if (redactedCount < target && Math.random() < 0.45) {
      const level = (Math.floor(Math.random() * 3) + 1) as 1 | 2 | 3;
      const type = level === 1 ? "l1" : level === 2 ? "l2" : "l3";
      result.push({
        type,
        value:
          type === "l1"
            ? "██████"
            : type === "l3"
              ? "[DONNÉES SUPPRIMÉES PAR ORDRE DU COMITÉ O5]"
              : s.slice(0, Math.min(40, s.length)),
      });
      redactedCount++;
    } else {
      result.push({ type: "text", value: s });
    }
  }
  return result;
}
