/**
 * Conseil O5 — 12 membres canoniques (O5-1 = le joueur).
 * Doublé côté Rust dans `database::O5_COUNCIL` pour la génération IA.
 */

export type O5Bias =
  | "cautious"
  | "aggressive"
  | "rational"
  | "mercenary"
  | "compassionate"
  | "enigmatic";

export interface O5Member {
  id: string;
  codename: string;
  personality: string;
  bias: O5Bias;
}

export const O5_PLAYER: O5Member = {
  id: "O5-1",
  codename: "Vous",
  personality: "Vous, le joueur. Vous votez en dernier après lecture du débat.",
  bias: "rational",
};

export const O5_COUNCIL: O5Member[] = [
  {
    id: "O5-2",
    codename: "L'Architecte",
    personality:
      "Bureaucratique, ferme sur les protocoles, méfiante envers les solutions improvisées et envers l'IA",
    bias: "cautious",
  },
  {
    id: "O5-3",
    codename: "Le Stratège",
    personality:
      "Pragmatique militaire, calcule froidement les pertes acceptables, ancien commandant MTF",
    bias: "mercenary",
  },
  {
    id: "O5-4",
    codename: "La Théologienne",
    personality:
      "Ancienne membre du Vatican, voit les SCPs comme des manifestations spirituelles, ton mesuré et symbolique",
    bias: "enigmatic",
  },
  {
    id: "O5-5",
    codename: "Le Chirurgien",
    personality:
      "Scientifique pur, obsédé par la classification et la rigueur expérimentale, neutre émotionnellement",
    bias: "rational",
  },
  {
    id: "O5-6",
    codename: "L'Inquisiteur",
    personality:
      "Paranoïaque chronique, soupçonne infiltrations et trahisons, partisan de la destruction par défaut",
    bias: "aggressive",
  },
  {
    id: "O5-7",
    codename: "La Diplomate",
    personality:
      "Cherche systématiquement le compromis, défend les Classes D et le moral du personnel",
    bias: "compassionate",
  },
  {
    id: "O5-8",
    codename: "Le Programmeur",
    personality:
      "Ancien spécialiste IA, pragmatique, modélise les SCPs comme des systèmes algorithmiques",
    bias: "rational",
  },
  {
    id: "O5-9",
    codename: "Le Spectre",
    personality:
      "Identité totalement classifiée, parle peu et de façon énigmatique, vote selon des critères inconnus",
    bias: "enigmatic",
  },
  {
    id: "O5-10",
    codename: "La Chercheuse",
    personality:
      "Pousse pour l'expérimentation poussée, accepte des risques élevés au nom de l'avancée scientifique",
    bias: "aggressive",
  },
  {
    id: "O5-11",
    codename: "Le Commandant",
    personality:
      "Discipline militaire stricte, soutient les MTF, respecte la chaîne de commandement absolue",
    bias: "mercenary",
  },
  {
    id: "O5-12",
    codename: "L'Historienne",
    personality:
      "Mémoire institutionnelle, cite des précédents anciens (Foundation 1893+), prudente",
    bias: "cautious",
  },
  {
    id: "O5-13",
    codename: "L'Ombre",
    personality:
      "Quasiment jamais présent en séance, quand il s'exprime ses mots ont un poids singulier et son vote est mystérieux",
    bias: "enigmatic",
  },
];

export function getO5(id: string): O5Member | undefined {
  if (id === "O5-1") return O5_PLAYER;
  return O5_COUNCIL.find((m) => m.id === id);
}

/** Couleur d'accent suggérée pour chaque biais d'O5. */
export const O5_BIAS_COLOR: Record<O5Bias, string> = {
  cautious: "var(--accent-cyan)",
  aggressive: "var(--accent-red-glow)",
  rational: "var(--accent-white)",
  mercenary: "var(--accent-amber)",
  compassionate: "var(--accent-green)",
  enigmatic: "var(--text-secondary)",
};
