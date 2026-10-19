import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { API_BASE } from "../../api/config";
import { listExportJobs, type ExportJob } from "./api";
import { server } from "../../test/server";

const job: ExportJob = {
  id: "exp_1",
  owner_type: "workflow_run",
  owner_id: "run_1",
  format: "xlsx",
  status: "completed",
  filename: "result.xlsx",
  content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  size_bytes: 1024,
  error_message: null,
  created_at: "2026-10-15T00:00:00",
  started_at: "2026-10-15T00:00:01",
  completed_at: "2026-10-15T00:00:02"
};

describe("listExportJobs", () => {
  it("필터를 query string으로 보내고 목록을 돌려준다", async () => {
    let seenQuery: Record<string, string> = {};
    server.use(
      http.get(`${API_BASE}/api/export-jobs`, ({ request }) => {
        seenQuery = Object.fromEntries(new URL(request.url).searchParams);
        return HttpResponse.json([job]);
      })
    );

    const jobs = await listExportJobs({ ownerType: "workflow_run", ownerId: "run_1", status: "completed", limit: 5 });

    expect(jobs).toEqual([job]);
    expect(seenQuery).toEqual({ owner_type: "workflow_run", owner_id: "run_1", status: "completed", limit: "5" });
  });

  it("필터가 없으면 query string 없이 호출한다", async () => {
    let seenSearch = "unset";
    server.use(
      http.get(`${API_BASE}/api/export-jobs`, ({ request }) => {
        seenSearch = new URL(request.url).search;
        return HttpResponse.json([]);
      })
    );

    await expect(listExportJobs({})).resolves.toEqual([]);
    expect(seenSearch).toBe("");
  });

  it("실패 응답의 detail 문자열을 에러 메시지로 올린다", async () => {
    server.use(
      http.get(`${API_BASE}/api/export-jobs`, () => HttpResponse.json({ detail: "권한이 없습니다." }, { status: 403 }))
    );

    await expect(listExportJobs({ limit: 1 })).rejects.toThrow("권한이 없습니다.");
  });
});
