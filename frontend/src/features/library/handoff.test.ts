import { describe, expect, it } from "vitest";
import type { LibraryDocument } from "../../api/types";
import { clearHandedOffDocuments, handOffLibraryDocuments, peekHandedOffDocuments } from "./handoff";

const doc = { document_id: "d1", filename: "a.pdf" } as LibraryDocument;

describe("library handoff", () => {
  it("대상 화면별로 넘기고 비운다", () => {
    handOffLibraryDocuments("classifier", [doc]);
    expect(peekHandedOffDocuments("classifier")).toEqual([doc]);
    expect(peekHandedOffDocuments("rotation")).toEqual([]);
    clearHandedOffDocuments("classifier");
    expect(peekHandedOffDocuments("classifier")).toEqual([]);
  });
});
