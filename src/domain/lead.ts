export type LeadStatus =
  | "NEW"
  | "RESEARCHED"
  | "QUALIFIED"
  | "DISQUALIFIED"
  | "CONTACTED"
  | "REPLIED"
  | "MEETING"
  | "WON"
  | "LOST"
  | "DO_NOT_CONTACT";

export type Evidence = {
  sourceUrl: string;
  observation: string;
};

export type Lead = {
  id: string;
  companyName: string;
  websiteUrl?: string;
  contactName?: string;
  contactEmail?: string;
  city?: string;
  industry?: string;
  status: LeadStatus;
  fitScore?: number;
  opportunity?: string;
  evidence: Evidence[];
  sourceUrl?: string;
  createdAt: string;
  updatedAt: string;
};
