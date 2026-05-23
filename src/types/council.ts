/**
 * Conseil O5 — Types pour les motions et les débats simulés.
 */

export type MotionStatus = "OPEN" | "RESOLVED";

export type MotionKind = "COUNCIL" | "SOLO";

export type MotionCategory =
  | "CONTAINMENT"
  | "MTF_DEPLOYMENT"
  | "ETHICS"
  | "EXPERIMENT"
  | "PROTOCOL"
  | "OTHER";

export interface MotionOption {
  id: string; // 'A' | 'B' | 'C' | 'D'
  label: string;
  description?: string;
}

export interface O5Statement {
  o5_id: string; // 'O5-2' à 'O5-13'
  content: string;
  vote: string; // option id
}

export interface CouncilDebate {
  statements: O5Statement[];
}

export interface Motion {
  id: string;
  title: string;
  description: string;
  category: string;
  context: string | null;
  /** JSON sérialisé de MotionOption[] côté Rust → parsé côté React. */
  options: string;
  status: MotionStatus;
  created_at: string;
  closed_at: string | null;
  /** Option id gagnante ou 'DEADLOCK'. */
  result: string | null;
  /** JSON sérialisé de CouncilDebate. */
  debate: string | null;
  player_vote: string | null;
  /** JSON sérialisé de Record<string, number>. */
  tally: string | null;
  kind: MotionKind;
  resolution_summary: string | null;
  resolution_effects: string | null;
}

export interface CouncilEffectReport {
  action_type: string;
  status: string;
  detail: string;
}

export interface CouncilVoteResult {
  motion: Motion;
  resolution_summary: string | null;
  resolution_effects: string | null;
}

/** Helper pour parser les champs JSON stockés en string. */
export function parseMotionOptions(motion: Motion): MotionOption[] {
  try {
    return JSON.parse(motion.options) as MotionOption[];
  } catch {
    return [];
  }
}

export function parseMotionDebate(motion: Motion): CouncilDebate | null {
  if (!motion.debate) return null;
  try {
    return JSON.parse(motion.debate) as CouncilDebate;
  } catch {
    return null;
  }
}

export function parseResolutionEffects(
  motion: Motion,
): CouncilEffectReport[] {
  if (!motion.resolution_effects) return [];
  try {
    return JSON.parse(motion.resolution_effects) as CouncilEffectReport[];
  } catch {
    return [];
  }
}

export function parseMotionTally(motion: Motion): Record<string, number> {
  if (!motion.tally) return {};
  try {
    return JSON.parse(motion.tally) as Record<string, number>;
  } catch {
    return {};
  }
}
