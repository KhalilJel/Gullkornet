export type OpenOutreachLead = {
  id?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  company?: string;
  title?: string;
  website?: string;
  linkedin_url?: string;
  reason?: string;
  lead_id?: string;
  qualified_at?: string;
  profile_text?: string;
  [key: string]: unknown;
};

export type OpenOutreachFindInput = {
  count: number;
  emails?: boolean;
};

export type OpenOutreachCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type OpenOutreachCommandInput = {
  stdin?: string;
};

export type OpenOutreachCommandExecutor = (
  command: string,
  args: string[],
  timeoutMs: number,
  input?: OpenOutreachCommandInput
) => Promise<OpenOutreachCommandResult>;

export type OpenOutreachClientOptions = {
  command?: string;
  timeoutMs?: number;
  allowSend?: boolean;
  executor?: OpenOutreachCommandExecutor;
};

export type OpenOutreachClient = {
  findLeads(input: OpenOutreachFindInput): Promise<OpenOutreachLead[]>;
  ingestLeads(leads: OpenOutreachLead[]): Promise<OpenOutreachCommandResult>;
  send(count?: number | "all"): Promise<OpenOutreachCommandResult>;
};

const DEFAULT_TIMEOUT_MS = 60_000;

function parseLeads(stdout: string): OpenOutreachLead[] {
  const leads: OpenOutreachLead[] = [];

  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error("OPENOUTREACH_INVALID_JSONL");
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("OPENOUTREACH_INVALID_LEAD_RECORD");
    }

    leads.push(parsed as OpenOutreachLead);
  }

  return leads;
}

export function createOpenOutreachClient(
  options: OpenOutreachClientOptions = {}
): OpenOutreachClient {
  const command = options.command ?? process.env.OPENOUTREACH_COMMAND ?? "openoutreach";
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const allowSend = options.allowSend ?? process.env.OPENOUTREACH_ALLOW_SEND === "true";
  const executor = options.executor ?? defaultExecutor;

  async function run(args: string[], input?: OpenOutreachCommandInput): Promise<OpenOutreachCommandResult> {
    const result = await executor(command, args, timeoutMs, input);

    if (result.exitCode !== 0) {
      throw new Error(`OPENOUTREACH_EXIT_${result.exitCode}`);
    }

    return result;
  }

  return {
    async findLeads(input) {
      if (!Number.isInteger(input.count) || input.count < 1) {
        throw new Error("OPENOUTREACH_INVALID_COUNT");
      }

      const args = ["find", String(input.count)];
      if (input.emails) args.push("emails");
      args.push("--json");

      const result = await run(args);
      return parseLeads(result.stdout);
    },

    async ingestLeads(leads) {
      if (!leads.length) {
        throw new Error("OPENOUTREACH_EMPTY_INGEST");
      }

      const jsonl = leads.map((lead) => JSON.stringify(lead)).join("\n") + "\n";
      return run(["outsend"], { stdin: jsonl });
    },

    async send(_count = "all") {
      // Phase 11 safety lock: the legacy OpenOutreach send path lacks the
      // approved-recipient, persistent rate-limit, and reply/suppression gates.
      // Do not let OPENOUTREACH_ALLOW_SEND or constructor options bypass it.
      throw new Error("OPENOUTREACH_SEND_DISABLED_PHASE11");
    }
  };
}

async function defaultExecutor(
  command: string,
  args: string[],
  timeoutMs: number,
  input?: OpenOutreachCommandInput
): Promise<OpenOutreachCommandResult> {
  const { spawn } = await import("node:child_process");

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: [input?.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    if (input?.stdin !== undefined && child.stdin) {
      child.stdin.end(input.stdin);
    }
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("OPENOUTREACH_TIMEOUT"));
    }, timeoutMs);

    if (child.stdout) {
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }

    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.once("close", (exitCode) => {
      clearTimeout(timeout);
      resolve({ stdout, stderr, exitCode: exitCode ?? 1 });
    });
  });
}
