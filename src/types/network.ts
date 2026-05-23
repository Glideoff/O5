export type SiteStatus = "ONLINE" | "OFFLINE" | "ALERT";

export interface NetworkDevice {
  site_id: string;
  ip: string;
  hostname: string;
  os: string;
  overseer_version: string;
  status: SiteStatus | string;
  is_self: boolean;
  last_seen: string;
}
