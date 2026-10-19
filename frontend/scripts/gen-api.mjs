// OpenAPI 스펙을 서버 없이 백엔드 앱에서 직접 뽑아 openapi.json으로 저장하고,
// openapi-typescript로 src/api/schema.d.ts를 만든다. 사용: `npm run gen:api`
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backendDir = path.resolve(frontendDir, "../backend");
const pythonBin = path.resolve(frontendDir, "../.venv/bin/python");
const specPath = path.join(frontendDir, "openapi.json");
const schemaPath = path.join(frontendDir, "src/api/schema.d.ts");

// import만 하고 lifespan은 돌지 않지만, 혹시 모를 부작용을 막으려고 DB·저장소를 임시 경로로 돌린다.
const workDir = mkdtempSync(path.join(tmpdir(), "daw-openapi-"));
try {
  const spec = execFileSync(
    pythonBin,
    ["-c", "import json; from app.main import app; print(json.dumps(app.openapi(), ensure_ascii=False, indent=1))"],
    {
      cwd: backendDir,
      env: {
        ...process.env,
        DATABASE_URL: `sqlite:///${path.join(workDir, "openapi.db")}`,
        DOCUMENT_STORAGE_DIR: path.join(workDir, "documents"),
        RAW_STORAGE_DIR: path.join(workDir, "raw"),
        PROCESSING_TMP_DIR: path.join(workDir, "processing"),
        EXPORT_STORAGE_DIR: path.join(workDir, "exports"),
        VLM_PROVIDER: "mock"
      },
      maxBuffer: 64 * 1024 * 1024
    }
  ).toString();
  JSON.parse(spec);
  writeFileSync(specPath, spec);
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

execFileSync("npx", ["openapi-typescript", specPath, "-o", schemaPath], { cwd: frontendDir, stdio: "inherit" });
