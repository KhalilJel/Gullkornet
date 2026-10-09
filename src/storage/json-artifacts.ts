import { randomUUID } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/**
 * Write a complete JSON artifact to a private temporary file and atomically rename it
 * into place. A failed write leaves the previous artifact intact.
 */
export async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  const targetPath = resolve(filePath);
  const temporaryPath = targetPath + ".tmp-" + process.pid + "-" + randomUUID();
  await mkdir(dirname(targetPath), { recursive: true });
  try {
    await writeFile(temporaryPath, JSON.stringify(value, null, 2) + "\n", {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx"
    });
    await rename(temporaryPath, targetPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}
