export type BrowserUseTask = {
  url: string;
  goal: string;
};

export type BrowserUseStatus = "success" | "blocked" | "failed";

export type BrowserUseResult = {
  status: BrowserUseStatus;
  finalUrl?: string;
  evidence: string[];
  failureReason?: string;
};

export type BrowserUseExecutor = (
  task: BrowserUseTask
) => Promise<BrowserUseResult>;

/**
 * Minimal provider boundary for Browser Use.
 *
 * The orchestrator owns when this fallback is invoked. The provider owns
 * browser execution. No provider credentials or runtime details belong here.
 */
export async function executeBrowserUse(
  task: BrowserUseTask,
  executor: BrowserUseExecutor
): Promise<BrowserUseResult> {
  if (!task.url.trim()) throw new Error("BROWSER_USE_URL_REQUIRED");
  if (!task.goal.trim()) throw new Error("BROWSER_USE_GOAL_REQUIRED");

  const result = await executor(task);

  if (result.status === "success" && !result.finalUrl) {
    throw new Error("BROWSER_USE_SUCCESS_REQUIRES_FINAL_URL");
  }

  if (result.status !== "success" && !result.failureReason) {
    throw new Error("BROWSER_USE_FAILURE_REQUIRES_REASON");
  }

  return result;
}
