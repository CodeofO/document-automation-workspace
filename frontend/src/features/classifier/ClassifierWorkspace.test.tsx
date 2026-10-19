import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { API_BASE } from "../../api/config";
import { DialogProvider, ToastProvider } from "../../components/ui";
import { server } from "../../test/server";
import type { LibraryDocument } from "../library";
import { ModuleWorkspace } from "../module-batch";
import { classifierModule } from "./config";

const classifier = {
  id: "cls_1",
  name: "접수 문서 분류",
  description: null,
  allow_unknown: true,
  archived: false,
  classes: [{ class_name: "신청서", description: "신청서", signals: ["신청"] }],
  created_at: "2026-10-15T00:00:00",
  updated_at: "2026-10-15T00:00:00"
};

function libraryDocument(id: string): LibraryDocument {
  return {
    document_id: id,
    filename: `${id}.pdf`,
    library_path: null,
    mime_type: "application/pdf",
    size_bytes: 10,
    page_count: 2,
    status: "ready",
    created_at: "2026-10-15T00:00:00"
  };
}

const batch = {
  id: "batch_1",
  classifier_id: "cls_1",
  status: "running",
  total_count: 2,
  completed_count: 0,
  failed_count: 1,
  canceled_count: 0,
  uploaded_count: 2,
  preprocessing_count: 0,
  ready_count: 0,
  queued_count: 0,
  running_count: 1,
  needs_review_count: 0,
  progress_phase: "running",
  progress: 0.5,
  items: [
    { id: "i1", document_id: "d1", job_id: "j1", filename: "d1.pdf", status: "running", page_number: 1, created_at: "" },
    { id: "i2", document_id: "d1", job_id: "j2", filename: "d1.pdf", status: "failed", page_number: 2, created_at: "" }
  ],
  created_at: "2026-10-15T00:00:00",
  completed_at: null
};

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <DialogProvider>{children}</DialogProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

describe("ModuleWorkspace (분류)", () => {
  it("보관 문서로 배치를 만들고 페이지 단위 라벨과 상태 tone을 보여준다", async () => {
    let batchBody: unknown = null;
    server.use(
      http.get(`${API_BASE}/api/document-classifiers`, () => HttpResponse.json([classifier])),
      http.patch(`${API_BASE}/api/document-classifiers/cls_1`, () => HttpResponse.json(classifier)),
      http.post(`${API_BASE}/api/classification-batches/from-documents`, async ({ request }) => {
        batchBody = await request.json();
        return HttpResponse.json(batch);
      }),
      http.get(`${API_BASE}/api/classification-batches/batch_1`, () => HttpResponse.json(batch)),
      http.get(`${API_BASE}/api/classification-batches/batch_1/summary`, () => HttpResponse.json({ ...batch, items: [] })),
      http.get(`${API_BASE}/api/documents/d1`, () =>
        HttpResponse.json({ ...libraryDocument("d1"), pages: [], created_at: "" })
      ),
      http.get(`${API_BASE}/api/classification-jobs/:jobId`, ({ params }) =>
        HttpResponse.json({ job_id: params.jobId, document_id: "d1", status: "running", error_message: null, result_id: null, page_number: 1 })
      ),
      http.get(`${API_BASE}/api/export-jobs`, () => HttpResponse.json([]))
    );

    render(
      <ModuleWorkspace
        config={classifierModule}
        uploadMaxBatchFiles={100}
        uploadChunkFiles={10}
        initialLibraryDocuments={[libraryDocument("d1"), libraryDocument("d2")]}
      />,
      { wrapper }
    );

    expect(await screen.findByRole("heading", { level: 2, name: "접수 문서 분류" })).toBeInTheDocument();
    expect(screen.getByText("2개 보관 문서를 선택했습니다.")).toBeInTheDocument();

    const [runButton] = screen.getAllByRole("button", { name: "실행" });
    fireEvent.click(runButton);

    expect(await screen.findByText("d1.pdf · p.2")).toBeInTheDocument();
    expect(batchBody).toEqual({ classifier_id: "cls_1", document_ids: ["d1", "d2"] });
    const failedRow = screen.getByText("d1.pdf · p.2").closest("button") as HTMLElement;
    expect(within(failedRow).getByText("실패")).toHaveAttribute("data-tone", "danger");
    expect(await screen.findByText(/배치 작업을 시작했습니다/)).toBeInTheDocument();
  });
});

describe("ModuleWorkspace (분류) 결과 수정", () => {
  it("결과를 고쳐도 [수정 저장] 전에는 PATCH하지 않는다", async () => {
    const patches: unknown[] = [];
    const job = {
      job_id: "j1",
      document_id: "d1",
      status: "completed",
      error_message: null,
      result_id: "r1",
      page_number: 1,
      result: {
        id: "r1",
        job_id: "j1",
        reviewed: false,
        corrected_output: null,
        validated_output: {
          document_id: "d1",
          classifier_id: "cls_1",
          status: "classified",
          class_name: "신청서",
          confidence: 0.9,
          reason: "신청 문구",
          evidence: ["신청"],
          page_number: 1
        }
      }
    };
    server.use(
      http.get(`${API_BASE}/api/document-classifiers`, () => HttpResponse.json([classifier])),
      http.patch(`${API_BASE}/api/document-classifiers/cls_1`, () => HttpResponse.json(classifier)),
      http.post(`${API_BASE}/api/classification-jobs`, () => HttpResponse.json(job)),
      http.get(`${API_BASE}/api/classification-jobs/j1`, () => HttpResponse.json(job)),
      http.get(`${API_BASE}/api/documents/d1`, () =>
        HttpResponse.json({ ...libraryDocument("d1"), page_count: 1, pages: [], created_at: "" })
      ),
      http.patch(`${API_BASE}/api/classification-results/r1`, async ({ request }) => {
        patches.push(await request.json());
        return HttpResponse.json({ ...job.result, reviewed: true });
      })
    );

    render(
      <ModuleWorkspace
        config={classifierModule}
        uploadMaxBatchFiles={100}
        uploadChunkFiles={10}
        initialLibraryDocuments={[{ ...libraryDocument("d1"), page_count: 1 }]}
      />,
      { wrapper }
    );

    await screen.findByRole("heading", { level: 2, name: "접수 문서 분류" });
    fireEvent.click(screen.getAllByRole("button", { name: "실행" })[0]);
    const select = await screen.findByRole("combobox", { name: "문서 클래스 수정" });
    fireEvent.change(select, { target: { value: "" } });
    expect(await screen.findByText("수정됨 · 저장 전")).toBeInTheDocument();
    expect(patches).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "수정 저장" }));
    await screen.findByText("수정한 결과를 저장했습니다.");
    expect(patches).toEqual([{ corrected_output: expect.objectContaining({ class_name: null, status: "unknown" }), reviewed: true }]);
  });
});
