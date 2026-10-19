import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { deflateSync } from "node:zlib";

export const BACKEND_BASE = process.env.E2E_BACKEND_BASE ?? "http://127.0.0.1:8011";

type LibraryDocument = { document_id: string; status: string; filename: string; library_path: string };

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

/**
 * 테스트용 문서 이미지(8-bit 회색조 PNG)를 그때그때 만든다. 같은 seed면 항상 같은 바이트다.
 * 흰 바탕에 제목 막대, 글줄처럼 보이는 막대 몇 줄, 오른쪽 아래 서명 칸 테두리를 그린다.
 */
export function makePng(options: { width?: number; height?: number; seed?: number } = {}): Buffer {
  const width = options.width ?? 620;
  const height = options.height ?? 860;
  const seed = options.seed ?? 0;
  const pixels = Buffer.alloc(width * height, 255);
  const fill = (x0: number, y0: number, w: number, h: number, value: number) => {
    for (let y = Math.max(0, y0); y < Math.min(height, y0 + h); y += 1) {
      pixels.fill(value, y * width + Math.max(0, x0), y * width + Math.min(width, x0 + w));
    }
  };
  fill(60, 50, width - 120, 36, 40);
  for (let line = 0; line < 14; line += 1) {
    const length = 180 + ((line * 97 + seed * 53) % (width - 300));
    fill(60, 130 + line * 34, length, 12, 90);
  }
  const box = { x: Math.round(width * 0.55), y: Math.round(height * 0.74), w: Math.round(width * 0.35), h: Math.round(height * 0.14) };
  fill(box.x, box.y, box.w, 3, 30);
  fill(box.x, box.y + box.h - 3, box.w, 3, 30);
  fill(box.x, box.y, 3, box.h, 30);
  fill(box.x + box.w - 3, box.y, 3, box.h, 30);

  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width + 1)] = 0; // filter: none
    pixels.copy(raw, y * (width + 1) + 1, y * width, (y + 1) * width);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 0; // grayscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

/** 화면 업로드(setInputFiles·dropFile)에 넘기는 PNG 파일 묶음. */
export function pngFile(name: string, seed = 0) {
  return { name, mimeType: "image/png", buffer: makePng({ seed }) };
}

/** API로 보관함에 테스트 이미지를 올리고 준비 완료가 될 때까지 기다린다. */
export async function seedLibraryDocument(request: APIRequestContext, name: string, seed = 0): Promise<LibraryDocument> {
  const response = await request.post(`${BACKEND_BASE}/api/library/uploads`, {
    multipart: {
      files: pngFile(name, seed),
      library_paths: name
    }
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const payload = await response.json();
  const documents: LibraryDocument[] = payload.documents ?? [];
  const created = documents[0];
  expect(created, JSON.stringify(payload)).toBeTruthy();
  await expect
    .poll(
      async () => {
        const res = await request.get(`${BACKEND_BASE}/api/documents/${created.document_id}`);
        return (await res.json()).status;
      },
      { timeout: 60_000 }
    )
    .toBe("ready");
  return created;
}

export async function openHome(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 2, name: "문서 검수를 한 번에 자동화하세요" })).toBeVisible();
}

export function uniqueName(prefix: string, ext = "png") {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e4)}.${ext}`;
}

/** 빈 페이지 N장짜리 최소 PDF(테스트용). 페이지마다 큰 숫자를 그려 구분한다. */
export function makePdf(pageCount: number): Buffer {
  const objects: string[] = [];
  const pageIds = Array.from({ length: pageCount }, (_, index) => 4 + index * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pageIds.forEach((id, index) => {
    const stream = `BT /F1 96 Tf 220 420 Td (${index + 1}) Tj ET`;
    objects[id] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`;
    objects[id + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(body);
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) body += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

/** 끌어다 놓기를 흉내 낸다(DataTransfer에 파일을 넣고 drop 이벤트를 보낸다). */
export async function dropFile(page: Page, selector: string, file: { name: string; mimeType: string; buffer: Buffer }) {
  const dataTransfer = await page.evaluateHandle(
    ({ name, mimeType, base64 }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], name, { type: mimeType }));
      return transfer;
    },
    { name: file.name, mimeType: file.mimeType, base64: file.buffer.toString("base64") }
  );
  await page.dispatchEvent(selector, "dragover", { dataTransfer });
  await page.dispatchEvent(selector, "drop", { dataTransfer });
}

async function postJson<T>(request: APIRequestContext, path: string, data: unknown): Promise<T> {
  const response = await request.post(`${BACKEND_BASE}${path}`, { data });
  expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy();
  return (await response.json()) as T;
}

export type WorkflowAssets = { schema: { id: string }; classifier: { id: string }; checklist: { id: string } };

/** 기존 API로 스키마(5필드)·분류기(3클래스)·필수 항목 체크리스트(4항목)를 만든다. 이름은 매번 고유하다. */
export async function createWorkflowAssets(request: APIRequestContext): Promise<WorkflowAssets> {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
  const schema = await postJson<{ id: string }>(request, "/api/schemas", {
    name: `e2e 서류 핵심 정보 ${suffix}`,
    description: "접수 서류에서 문서번호, 신청인, 신청일, 금액, 발급기관을 추출합니다.",
    fields: [
      { key_name: "문서번호", description: "문서번호 또는 접수번호입니다.", output_format: "string" },
      { key_name: "신청인", description: "신청인 이름입니다.", output_format: "string" },
      { key_name: "신청일", description: "신청일 또는 작성일입니다.", output_format: "date" },
      { key_name: "금액", description: "신청 금액 또는 합계입니다.", output_format: "float" },
      { key_name: "발급기관", description: "문서를 발급한 기관입니다.", output_format: "string" }
    ]
  });
  const classifier = await postJson<{ id: string }>(request, "/api/document-classifiers", {
    name: `e2e 문서 분류기 ${suffix}`,
    description: "접수 서류를 신청서, 동의서, 증빙문서로 분류합니다.",
    allow_unknown: true,
    classes: [
      { class_name: "신청서", description: "서비스 신청을 위한 신청서입니다.", signals: ["신청서", "신청인"] },
      { class_name: "동의서", description: "개인정보 수집·이용 동의서입니다.", signals: ["동의", "개인정보"] },
      { class_name: "증빙문서", description: "신청을 뒷받침하는 증빙 문서입니다.", signals: ["증명", "확인서"] }
    ]
  });
  const checklist = await postJson<{ id: string }>(request, "/api/required-field-checklists", {
    name: `e2e 필수 항목 ${suffix}`,
    description: "접수 전 누락되면 안 되는 항목을 확인합니다.",
    regions: [{ id: "signature_region", name: "서명 영역", page: 1, x: 0.55, y: 0.72, width: 0.35, height: 0.16 }],
    items: [
      { item_name: "신청인", description: "신청인 이름이 적혀 있는지 확인합니다.", evidence_type: "text_or_handwriting" },
      { item_name: "작성일", description: "작성일이 적혀 있는지 확인합니다.", evidence_type: "text_or_handwriting" },
      { item_name: "필수 동의 체크", description: "필수 동의 표시가 있는지 확인합니다.", evidence_type: "checkbox" },
      {
        item_name: "서명 또는 날인",
        description: "서명 영역에 서명이나 날인이 있는지 확인합니다.",
        evidence_type: "signature_or_stamp",
        region_id: "signature_region"
      }
    ]
  });
  return { schema, classifier, checklist };
}

export const BRANCH_KEYS = ["class:신청서", "class:동의서", "class:증빙문서", "unknown"];

/**
 * 분류 → 분기 → (신청서: KIE → 필수 항목 / 동의서: 필수 항목 / 증빙: KIE / unknown) → 병합 → Export
 * 워크플로우를 API로 만든다. 노드 이름은 Inspector 테스트가 그대로 찾는다.
 */
export async function createReviewWorkflow(
  request: APIRequestContext,
  name = `e2e 서류 분류 및 검수 ${Date.now()}`
): Promise<WorkflowAssets & { workflow: { id: string; name: string } }> {
  const assets = await createWorkflowAssets(request);
  const node = (id: string, kind: string, label: string, x: number, y: number, config?: Record<string, unknown>) => ({
    id,
    position: { x, y },
    data: { kind, label, ...(config ? { config } : {}) }
  });
  const nodes = [
    node("input", "input", "문서 입력", 40, 240),
    node("classifier", "classifier", "서류 분류", 250, 240, { classifier_id: assets.classifier.id }),
    { ...node("branch", "branch", "문서 종류 분기", 460, 210), data: { kind: "branch", label: "문서 종류 분기", branchKeys: BRANCH_KEYS } },
    node("kie_application", "kie", "신청서 핵심 정보 추출", 670, 70, { schema_id: assets.schema.id }),
    node("required_application", "required-checker", "신청서 필수 항목 확인", 900, 70, { checklist_id: assets.checklist.id }),
    node("required_consent", "required-checker", "동의서 필수 항목 확인", 670, 240, { checklist_id: assets.checklist.id }),
    node("kie_supporting", "kie", "증빙 정보 추출", 670, 410, { schema_id: assets.schema.id }),
    node("merge", "merge", "결과 병합", 900, 300),
    node("export", "export", "Export", 1110, 300)
  ];
  const edges = [
    { id: "input-classifier", source: "input", target: "classifier" },
    { id: "classifier-branch", source: "classifier", target: "branch" },
    { id: "branch-application", source: "branch", target: "kie_application", sourceHandle: "class:신청서" },
    { id: "branch-consent", source: "branch", target: "required_consent", sourceHandle: "class:동의서" },
    { id: "branch-supporting", source: "branch", target: "kie_supporting", sourceHandle: "class:증빙문서" },
    { id: "branch-unknown", source: "branch", target: "merge", sourceHandle: "unknown" },
    { id: "application-kie-required", source: "kie_application", target: "required_application" },
    { id: "application-required-merge", source: "required_application", target: "merge" },
    { id: "consent-required-merge", source: "required_consent", target: "merge" },
    { id: "supporting-kie-merge", source: "kie_supporting", target: "merge" },
    { id: "merge-export", source: "merge", target: "export" }
  ];
  const workflow = await postJson<{ id: string; name: string }>(request, "/api/workflows", {
    name,
    description: "문서를 분류한 뒤 종류별로 핵심 정보 추출과 필수 항목 확인을 실행합니다.",
    definition: { nodes, edges }
  });
  return { ...assets, workflow };
}

/** 저장된 워크플로우를 빌더에서 연다(/workflows/<id>). */
export async function openWorkflow(page: Page, workflow: { id: string; name: string }) {
  await page.goto(`/workflows/${encodeURIComponent(workflow.id)}`);
  await expect(page.getByRole("heading", { level: 1, name: "워크플로우 빌더" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "워크플로우 이름" })).toHaveValue(workflow.name);
}

/** 빌더 툴바의 보관함 picker에서 실행할 문서를 고른다(기존 선택은 해제). */
export async function pickRunDocuments(page: Page, search: string, filenames: string[]) {
  await page.locator(".workflow-toolbar .library-picker-trigger").click();
  const picker = page.getByRole("dialog", { name: /실행할 문서 선택/ });
  await expect(picker.getByRole("heading", { name: "실행할 문서 선택" })).toBeVisible();
  const clear = picker.getByRole("button", { name: "선택 해제", exact: true });
  if (await clear.isVisible().catch(() => false)) await clear.click();
  await picker.getByPlaceholder("파일명 또는 경로 검색").fill(search);
  for (const filename of filenames) {
    await picker.getByRole("button", { name: new RegExp(`^${filename.replace(/\./g, "\\.")} `) }).first().click();
  }
  await picker.getByRole("button", { name: "선택 적용" }).click();
  await expect(page.getByRole("button", { name: `${filenames.length}개 문서 선택됨` })).toBeVisible();
}
