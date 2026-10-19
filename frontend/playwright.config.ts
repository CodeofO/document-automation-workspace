import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// e2e는 자체 백엔드/프런트를 임시 DB·저장소와 mock VLM으로 띄운다.
// 서비스(8000/5173)와 겹치지 않도록 별도 포트를 쓴다.
const BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT ?? 8011);
const FRONTEND_PORT = Number(process.env.E2E_FRONTEND_PORT ?? 5184);
const BACKEND_BASE = `http://127.0.0.1:${BACKEND_PORT}`;
const FRONTEND_BASE = `http://127.0.0.1:${FRONTEND_PORT}`;

const frontendDir = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(frontendDir, "../backend");
const pythonBin = path.resolve(frontendDir, "../.venv/bin/python");

// 설정 파일은 워커마다 다시 로드되므로, 임시 디렉터리는 메인 프로세스에서 한 번만 만들고 env로 물려준다.
if (!process.env.E2E_WORK_DIR) {
  process.env.E2E_WORK_DIR = mkdtempSync(path.join(tmpdir(), "daw-e2e-"));
}
const workDir = process.env.E2E_WORK_DIR;
process.env.E2E_BACKEND_BASE = BACKEND_BASE;

const backendEnv: Record<string, string> = {
  APP_ENV: "local",
  DATABASE_URL: `sqlite:///${path.join(workDir, "e2e.db")}`,
  DOCUMENT_STORAGE_DIR: path.join(workDir, "documents"),
  RAW_STORAGE_DIR: path.join(workDir, "raw"),
  PROCESSING_TMP_DIR: path.join(workDir, "processing"),
  EXPORT_STORAGE_DIR: path.join(workDir, "exports"),
  VLM_PROVIDER: "mock",
  VLM_MODEL_NAME: "mock-vlm",
  CORS_ALLOW_ORIGIN_REGEX: "^http://(localhost|127\\.0\\.0\\.1):\\d+$",
  PYTHONUNBUFFERED: "1"
};

export default defineConfig({
  testDir: "./e2e",
  // 화면 캡처(e2e/screens)는 playwright.screens.config.ts로 따로 돌린다.
  testIgnore: ["**/screens/**"],
  globalTeardown: "./e2e/global-teardown.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: FRONTEND_BASE,
    locale: "ko-KR",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    {
      command: `"${pythonBin}" -m alembic upgrade head && "${pythonBin}" -m uvicorn app.main:app --host 127.0.0.1 --port ${BACKEND_PORT} --log-level warning`,
      cwd: backendDir,
      env: backendEnv,
      url: `${BACKEND_BASE}/api/health`,
      reuseExistingServer: Boolean(process.env.E2E_REUSE_SERVERS),
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe"
    },
    {
      command: `npx vite --host 127.0.0.1 --port ${FRONTEND_PORT} --strictPort`,
      cwd: frontendDir,
      env: { VITE_API_BASE_URL: BACKEND_BASE },
      url: FRONTEND_BASE,
      reuseExistingServer: Boolean(process.env.E2E_REUSE_SERVERS),
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe"
    }
  ]
});
