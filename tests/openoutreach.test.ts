import assert from "node:assert/strict";
import test from "node:test";
import { createOpenOutreachClient } from "../src/integrations/openoutreach.js";

function mockExecutor(
  result: { stdout?: string; stderr?: string; exitCode?: number }
) {
  return async (_command: string, _args: string[], _timeoutMs: number) => ({
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.exitCode ?? 0
  });
}

test("OpenOutreach parses JSON Lines from find", async () => {
  const client = createOpenOutreachClient({
    command: "openoutreach",
    executor: mockExecutor({
      stdout: '{"lead_id":"1","company":"Example AS","reason":"Good fit"}\n{"lead_id":"2","company":"Other AS"}\n'
    })
  });

  const leads = await client.findLeads({ count: 2, emails: true });

  assert.equal(leads.length, 2);
  assert.equal(leads[0].company, "Example AS");
});

test("OpenOutreach passes the bounded find command", async () => {
  let captured: string[] = [];

  const client = createOpenOutreachClient({
    executor: async (_command, args) => {
      captured = args;
      return { stdout: "", stderr: "", exitCode: 0 };
    }
  });

  await client.findLeads({ count: 5, emails: true });

  assert.deepEqual(captured, ["find", "5", "emails", "--json"]);
});

test("OpenOutreach rejects malformed JSON Lines", async () => {
  const client = createOpenOutreachClient({
    executor: mockExecutor({ stdout: "not-json\n" })
  });

  await assert.rejects(
    () => client.findLeads({ count: 1 }),
    /OPENOUTREACH_INVALID_JSONL/
  );
});

test("OpenOutreach ingests KeeLead leads through the JSONL pipe", async () => {
  let captured = "";
  const client = createOpenOutreachClient({
    executor: async (_command, args, _timeoutMs, input) => {
      assert.deepEqual(args, ["outsend"]);
      captured = input?.stdin ?? "";
      return { stdout: "", stderr: "", exitCode: 0 };
    }
  });

  await client.ingestLeads([
    { lead_id: "1", company: "Example AS", email: "test@example.com" },
    { lead_id: "2", company: "Other AS", email: "other@example.com" }
  ]);

  const lines = captured.trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].lead_id, "1");
  assert.equal(lines[1].company, "Other AS");
});

test("OpenOutreach rejects empty ingest", async () => {
  const client = createOpenOutreachClient({ executor: mockExecutor({}) });

  await assert.rejects(
    () => client.ingestLeads([]),
    /OPENOUTREACH_EMPTY_INGEST/
  );
});

test("OpenOutreach surfaces command failures", async () => {
  const client = createOpenOutreachClient({
    executor: mockExecutor({ exitCode: 7 })
  });

  await assert.rejects(
    () => client.findLeads({ count: 1 }),
    /OPENOUTREACH_EXIT_7/
  );
});

test("OpenOutreach send remains hard-disabled during Phase 11 even when explicitly enabled", async () => {
  const client = createOpenOutreachClient({
    executor: mockExecutor({}),
    allowSend: true
  });

  await assert.rejects(
    () => client.send(1),
    /OPENOUTREACH_SEND_DISABLED_PHASE11/
  );
});
