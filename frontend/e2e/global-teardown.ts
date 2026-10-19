import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// playwright.config.ts가 만든 임시 DB/저장소 디렉터리를 지운다. E2E_KEEP_WORK_DIR=1이면 남긴다.
export default function globalTeardown() {
  const workDir = process.env.E2E_WORK_DIR;
  if (!workDir || process.env.E2E_KEEP_WORK_DIR) return;
  const resolved = path.resolve(workDir);
  if (!path.basename(resolved).startsWith("daw-e2e-") || !resolved.startsWith(path.resolve(tmpdir()))) return;
  rmSync(resolved, { recursive: true, force: true });
}
