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

export type WebsiteIssue =
  | "NO_WEBSITE"
  | "OUTDATED_DESIGN"
  | "UNCLEAR_SERVICES"
  | "WEAK_CONTACT_PATH"
  | "MOBILE_USABILITY"
  | "PERFORMANCE"
  | "NONE";

export type Evidence = {
  sourceUrl: string;
  observation: string;
  checkedAt?: string;
};

export type Lead = {
  id: string;
  companyName: string;
  websiteUrl?: string;
  contactName?: string;
  contactEmail?: string;
  city?: string;
  industry?: string;
  employeeCount?: number;
  websiteIssue?: WebsiteIssue;
  status: LeadStatus;
  fitScore?: number;
  opportunity?: string;
  evidence: Evidence[];
  sourceUrl?: string;
  createdAt: string;
  updatedAt: string;
};
