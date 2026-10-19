import { describe, expect, it } from "vitest";
import { isTerminalStatus, statusLabel, statusTone } from "./status";
import { documentLabel, formatBytes } from "./format";
import { chunkFiles, clientFileId } from "./files";

describe("status vocabulary", () => {
  it("failed는 항상 danger tone이다", () => {
    expect(statusTone("failed")).toBe("danger");
    expect(statusLabel("failed")).toBe("실패");
  });

  it("문서 주어에서 preprocessing은 변환 중이다", () => {
    expect(statusLabel("preprocessing", "document")).toBe("변환 중");
    expect(statusLabel("preprocessing")).toBe("전처리 중");
  });

  it("null 상태는 대시로 표시한다", () => {
    expect(statusLabel(null)).toBe("–");
  });

  it("terminal 집합", () => {
    expect(isTerminalStatus("completed")).toBe(true);
    expect(isTerminalStatus("running")).toBe(false);
    expect(isTerminalStatus("paused")).toBe(false);
  });
});

describe("format helpers", () => {
  it("documentLabel은 page_number가 있을 때만 페이지를 붙인다", () => {
    expect(documentLabel("a.pdf", 3)).toBe("a.pdf · p.3");
    expect(documentLabel("a.pdf", null)).toBe("a.pdf");
    expect(documentLabel("a.pdf")).toBe("a.pdf");
  });

  it("formatBytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
  });
});

describe("file helpers", () => {
  it("chunkFiles는 크기대로 나눈다", () => {
    expect(chunkFiles([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("clientFileId는 인덱스·이름·크기를 포함한다", () => {
    const file = new File(["abc"], "a.txt", { lastModified: 1 });
    expect(clientFileId(file, 2)).toBe("2:a.txt:3:1");
  });
});
