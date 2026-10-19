import { describe, expect, it } from "vitest";
import type { LibraryDocument } from "../../api/types";
import {
  appendUniqueDocuments,
  clipboardLabel,
  filterLibraryFiles,
  libraryFilterParams,
  libraryPollInterval,
  libraryStatusLabel,
  mergeDocuments,
  selectRangeIds,
  toggleSelectedId
} from "./model";

function doc(id: string, overrides: Partial<LibraryDocument> = {}): LibraryDocument {
  return {
    document_id: id,
    filename: `${id}.pdf`,
    library_path: null,
    mime_type: "application/pdf",
    size_bytes: 1,
    page_count: 1,
    status: "ready",
    created_at: `2026-10-15T00:00:0${id.slice(-1)}`,
    ...overrides
  };
}

describe("mergeDocuments", () => {
  it("새 문서를 더하고 같은 id는 새 값으로 바꾼 뒤 최신순으로 정렬한다", () => {
    const merged = mergeDocuments([doc("d3"), doc("d1", { status: "failed" })], [doc("d1"), doc("d2")]);
    expect(merged.map((item) => item.document_id)).toEqual(["d3", "d2", "d1"]);
    expect(merged.find((item) => item.document_id === "d1")?.status).toBe("failed");
  });
});

describe("appendUniqueDocuments", () => {
  it("순서를 지키고 중복을 건너뛴다", () => {
    const result = appendUniqueDocuments([doc("d1")], [doc("d2"), doc("d1"), doc("d2")]);
    expect(result.map((item) => item.document_id)).toEqual(["d1", "d2"]);
  });
});

describe("selectRangeIds", () => {
  const documents = [doc("d1"), doc("d2", { status: "failed" }), doc("d3"), doc("d4")];

  it("anchor~target 사이의 선택 가능한 문서를 더한다(실패 문서 제외)", () => {
    expect(selectRangeIds(documents, ["d1"], "d1", "d3")?.ids).toEqual(["d1", "d3"]);
    expect(selectRangeIds(documents, [], "d4", "d2")?.ids).toEqual(["d3", "d4"]);
  });

  it("anchor가 목록에 없으면 null", () => {
    expect(selectRangeIds(documents, [], "missing", "d3")).toBeNull();
  });
});

describe("toggleSelectedId", () => {
  it("있으면 빼고 없으면 뒤에 붙인다", () => {
    expect(toggleSelectedId(["a", "b"], "a")).toEqual(["b"]);
    expect(toggleSelectedId(["a"], "b")).toEqual(["a", "b"]);
  });
});

describe("filterLibraryFiles", () => {
  it("지원 확장자만 남기고 경로순으로 정렬한다", () => {
    const files = [new File(["x"], "b.PDF"), new File(["x"], "a.txt"), new File(["x"], "a.xlsx")];
    expect(filterLibraryFiles(files).map((file) => file.name)).toEqual(["a.xlsx", "b.PDF"]);
  });
});

describe("libraryFilterParams", () => {
  it("빈 값은 빼고 검색어는 trim한다", () => {
    expect(libraryFilterParams({ folder: "a/b", query: "  inv ", status: "" }).toString()).toBe("library_path=a%2Fb&q=inv");
    expect(libraryFilterParams({ folder: "", query: " ", status: "ready" }).toString()).toBe("status=ready");
  });
});

describe("libraryPollInterval", () => {
  it("변환 중 문서나 업로드 대기가 있으면 빠르게, 아니면 idle 주기", () => {
    expect(libraryPollInterval([{ status: "ready" }], 0)).toBe(6000);
    expect(libraryPollInterval([{ status: "preprocessing" }], 0)).toBe(1500);
    expect(libraryPollInterval([{ status: "queued" }], 0)).toBe(1500);
    expect(libraryPollInterval([], 1)).toBe(1500);
  });
});

describe("labels", () => {
  it("보관함 상태 라벨", () => {
    expect(libraryStatusLabel("ready")).toBe("준비 완료");
    expect(libraryStatusLabel("queued")).toBe("변환 대기");
    expect(libraryStatusLabel("preprocessing")).toBe("변환 중");
    expect(libraryStatusLabel("deleted")).toBe("원본 삭제");
  });

  it("클립보드 라벨", () => {
    expect(clipboardLabel(null)).toBe("");
    expect(clipboardLabel({ mode: "cut", documentIds: ["a", "b"], folderPaths: ["f"] })).toBe("3개 이동 준비됨");
  });
});
