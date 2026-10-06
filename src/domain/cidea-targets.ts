import type { CideaTarget } from "./website-audit.js";

export const cideaTargets: Record<CideaTarget, {
  purpose: string;
  primaryQuestion: string;
}> = {
  CideaLead: {
    purpose: "Turn website visitors into qualified sales conversations.",
    primaryQuestion: "Does this website make it easy for the right business owner to understand the offer and take the next step?"
  },
  CideaMarketing: {
    purpose: "Demonstrate marketing expertise and create demand.",
    primaryQuestion: "Does this website attract the right audience, communicate expertise and convert attention into demand?"
  },
  CideaConsulting: {
    purpose: "Build authority and generate higher-value consulting opportunities.",
    primaryQuestion: "Does this website establish enough authority and clarity for a business decision-maker to trust Cidea with a consulting problem?"
  }
};
