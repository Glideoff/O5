export type PeerRole = "O5" | "MTF" | "RESEARCHER" | "CLASS_D" | string;

export interface Peer {
  site_id: string;
  role: PeerRole;
  addr: string;
  connected_at: string;
}

export interface ChatMessage {
  id: string;
  from: string;
  to: string;
  content: string;
  encrypted: boolean;
  timestamp: string;
  /** `true` si on a généré ce message localement (envoyé). */
  is_local: boolean;
}
