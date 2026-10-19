import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { API_BASE } from "../../api/config";
import { server } from "../../test/server";
import { createBatchFromDocuments, createModuleJob, waitForModuleJob } from "./api";
import type { ModuleEndpoints } from "./types";

const endpoints: ModuleEndpoints = {
  definitions: "/api/document-classifiers",
  batches: "/api/classification-batches",
  jobs: "/api/classification-jobs",
  results: "/api/classification-results",
  definitionField: "classifier_id"
};
const ref = { kind: "classifier" as const, endpoints };

describe("module-batch api", () => {
  it("정의 id를 모듈별 필드 이름으로 보낸다", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${API_BASE}/api/classification-batches/from-documents`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "b1", items: [] });
      }),
      http.post(`${API_BASE}/api/classification-jobs`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ job_id: "j1", status: "queued" });
      })
    );
    await createBatchFromDocuments(ref, "cls_1", ["d1", "d2"]);
    expect(body).toEqual({ classifier_id: "cls_1", document_ids: ["d1", "d2"] });
    await createModuleJob(ref, "d1", "cls_1");
    expect(body).toEqual({ document_id: "d1", classifier_id: "cls_1" });
  });

  it("job이 terminal이 될 때까지 기다리고 중간 상태를 알린다", async () => {
    const statuses = ["queued", "running", "running", "completed"];
    let calls = 0;
    server.use(
      http.get(`${API_BASE}/api/classification-jobs/j1`, () => {
        const status = statuses[Math.min(calls, statuses.length - 1)];
        calls += 1;
        return HttpResponse.json({ job_id: "j1", document_id: "d1", status, error_message: null, result_id: null });
      })
    );
    const seen: string[] = [];
    const originalSetTimeout = globalThis.setTimeout;
    // 폴링 간격을 0으로 줄여 테스트를 빠르게 한다.
    globalThis.setTimeout = ((fn: () => void) => originalSetTimeout(fn, 0)) as typeof setTimeout;
    try {
      const done = await waitForModuleJob(ref, "j1", { onProgress: (job) => seen.push(job.status) });
      expect(done.status).toBe("completed");
      expect(seen).toEqual(["queued", "running", "running"]);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
  });
});
