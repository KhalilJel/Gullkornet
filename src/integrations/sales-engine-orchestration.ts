import { writeJsonAtomically } from "../storage/json-artifacts.js";

export type SalesEngineArtifactBatch = {
  reviewQueuePath: string;
  reviewQueue: unknown;
  draftsPath: string;
  drafts: unknown;
  rejectedPath: string;
  rejected: unknown;
};

export type SalesEnginePersistenceDependencies = {
  writeJson?: (path: string, value: unknown) => Promise<void>;
  syncReviewQueue: (draftsPath: string) => Promise<void>;
};

/**
 * Persist each artifact atomically and only sync CRM after all local artifacts exist.
 * If any persistence step fails, the error propagates and the CRM sync is not started;
 * the next run can safely regenerate artifacts and rely on the idempotent CRM upsert.
 */
export async function persistSalesEngineArtifacts(
  batch: SalesEngineArtifactBatch,
  dependencies: SalesEnginePersistenceDependencies
): Promise<void> {
  const writeJson = dependencies.writeJson ?? writeJsonAtomically;
  await writeJson(batch.reviewQueuePath, batch.reviewQueue);
  await writeJson(batch.draftsPath, batch.drafts);
  await writeJson(batch.rejectedPath, batch.rejected);
  await dependencies.syncReviewQueue(batch.draftsPath);
}
