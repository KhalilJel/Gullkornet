export type ReachEvidence = {
  sourceUrl: string;
  platform: "web" | "github" | "reddit" | "twitter" | "youtube" | "linkedin" | "other";
  title?: string;
  excerpt?: string;
  collectedAt: string;
};

export type AgentReachClient = {
  read(url: string): Promise<ReachEvidence>;
  search(query: string): Promise<ReachEvidence[]>;
};

function requireCommand(): void {
  throw new Error(
    "Agent Reach is not installed in this runtime. Install agent-reach and expose its upstream tools before enabling live external research."
  );
}

/**
 * Agent Reach is intentionally a capability adapter rather than an HTTP wrapper.
 * The upstream project routes each platform to its current backend and the agent
 * calls those backends directly. This adapter keeps Gullkornet independent of
 * those implementation details.
 */
export function createAgentReachClient(): AgentReachClient {
  return {
    async read(_url) {
      requireCommand();
    },
    async search(_query) {
      requireCommand();
    }
  };
}
