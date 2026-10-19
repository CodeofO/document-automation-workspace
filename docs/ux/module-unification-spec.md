# 모듈 UI/UX 통일 스펙 (워크플로우 제외)

UX 자문(2026-10-15) 결과를 정리한 구현 스펙이다. 줄 번호는 재구성 전 `frontend/src/` 기준이다.
대상 모듈: 홈, 문서 보관함, 원문 추출, KIE, 문서 분류, 필수 항목 확인, 회전 보정, Export 이력, 설정.
원칙: 브랜드(토스 블루·그레이 `--tds-*`)는 그대로 두고, 같은 기능을 컴포넌트 하나로 통일한다.

## A. 주요 불일치 (요약)
- **업로드**
  - 업로드 메뉴가 `UnifiedUploadPicker`(App:721)와 `ModuleUploadPicker`(Module:295)로 복제돼 있다. 회전 보정은 label 버튼만 있고 드롭과 폴더 선택이 없다.
  - 업로드 경로가 셋이다.
    - 원문 추출은 `/api/raw-extractions`로 직접 올린다.
    - KIE 단건은 `/api/documents`로 직접 올린다.
    - 나머지는 보관함(`/api/library/uploads`)을 거친다.
  - 폴더 재귀는 보관함과 KIE만 된다.
  - KIE에서 개수 초과 오류가 녹색 success-card로 표시된다(App:2290/2307).
- **레이아웃**
  - 컨테이너, 열, gap(10/14/16)이 모듈마다 다르다.
  - 회전 보정은 좌우가 반대이고 분할 바가 없다.
  - 설정 목록이 KIE는 "Schema 목록", 모듈은 세 번째 열의 "설정 목록"이다.
  - 저장 방식이 KIE는 자동 저장, 모듈은 수동 저장이다.
- **상태**
  - 라벨 사전이 5벌이고, failed 색이 세 가지(주황, 회색, 빨강)다.
  - `BatchItemStatusPanel`은 failed가 아니면 모두 녹색으로 표시한다(App:4049, 버그).
  - 중단 버튼이 세 종류다. 피드백 채널은 4종(전역 alert, status-card, 토스트, window.alert)이다.
  - 폴링 주기가 1.2/1.8/2.5/5초로 제각각이다.
  - 빈 상태 클래스가 7종이다.
- **결과·편집기**
  - KIE 편집기는 div grid, 분류·필수항목은 `<table>`이다.
  - 필수항목 영역 지정은 숫자 6칸이다.
  - 분류·필수항목은 즉시 PATCH하고 단건 Export가 없다.
  - Export 메뉴가 두 벌이다.
  - `ModuleDocumentPreview`는 `DocumentViewer`의 축소판이다.
- **CSS**
  - 정의되지 않은 토큰 5개(`--tds-shadow-soft`, `--tds-gray-800`, `--tds-shadow-elevated`, `--tds-gray-400`, `--tds-blue-300`)를 참조한다.
  - hex가 약 410개이고, 녹회색 팔레트(#d9e0da, #53615a, #157f78)가 섞여 있다.
  - 중복 셀렉터가 있다(`.module-status-card` 6곳).

## B-1. ModulePage 뼈대
```
<ModulePage>
  PageHeader   eyebrow · title · description · steps? · [보조 액션] [Primary]
  JobStatusBar (선택) 진행률 · 카운터 · [다음 검토][Export ▾][계속][중단]
  Body = SplitPane(비율 저장)
    Rail(선택, 260)  BatchItemList / 폴더 / 기록
    Main(≥360)       DocumentInput(빈 상태) | DocumentViewer | 결과 그리드(회전)
    Side(≥400)       DefinitionEditor 카드 → Result 카드
  Drawer(우측)       정의 목록 (Schema/분류기/체크리스트)
```
- 왼쪽은 문서, 오른쪽은 정의와 결과로 고정한다. 회전 보정도 이 규칙을 따른다.
- 피드백은 PageHeader 아래 `InlineAlert`와 전역 `Toast`만 쓴다. 전역 `.alert`, status-card, window.alert는 제거한다.
- 반응형:
  - 1100px 이하: Rail을 가로 칩으로 접는다.
  - 980px 이하: Main과 Side를 세로로 쌓고 Side를 탭으로 만든다.
  - 640px 이하: 액션을 ⋯ 메뉴로 넣는다.
- 설정 버튼은 전역 상단바에 항상 둔다. StepPill은 `PageHeader.steps`로 일반화한다.

## B-2. DocumentInput (단일 컴포넌트)
```ts
type DocumentInputProps = {
  accept?: DocumentKind[];   // 기본 pdf,image,docx,pptx,xlsx
  multiple?: boolean;        // 기본 true
  allowFolder?: boolean;     // 기본 true
  allowLibrary?: boolean;    // 기본 true
  sample?: { label: string; onUse: () => void } | null;
  maxFiles: number; chunkSize: number;
  variant: "zone" | "button";
  onReady: (docs: LibraryDocument[]) => void; // 결과는 항상 보관함 문서
};
```
- **업로드 경로는 하나다.** 모든 업로드는 `/api/library/uploads`로 청크 업로드한 뒤 `onReady`를 호출한다. 실행은 각 모듈이 `from-documents`로 한다.
  - KIE 단건 직접 업로드와 원문 추출 직접 업로드는 이 경로로 바꾼다. 원문 추출은 백엔드에 document_id 입력을 추가한다.
  - 미사용 `runBatch`(Module:676)는 삭제한다.
- **zone 변형:** UploadCloud 아이콘, "문서를 끌어다 놓거나 선택하세요", 허용 형식 자동 문구, [파일 선택][폴더 선택][보관함에서 선택], 샘플 링크.
- **button 변형:** "문서 추가 ▾" 메뉴(파일, 폴더, 보관함). 문서가 선택돼 있으면 "N개 문서 선택됨"으로 바꾼다.
- **상태:**
  - idle
  - dragging: accent 테두리, "놓으면 보관함에 업로드됩니다"
  - uploading: progress, "업로드 중 n / N", 취소
  - partial-error: 실패 목록과 재시도
  - error: InlineAlert
  - selected: 선택 미리보기 하나로 통일
- **규칙:**
  - 드롭은 항상 폴더를 재귀 처리한다(`filesFromDataTransfer`).
  - 지원하지 않는 형식은 제외하고 warning을 띄운다.
  - 개수 초과는 danger로 띄운다.
- **처리 단위:** 여러 페이지 문서는 페이지(이미지) 단위로 처리된다(계획 문서 §8.1). 선택 미리보기에 "PDF 3개 · 21페이지"처럼 페이지 수를 함께 보여준다.

## B-3. 상태 어휘 (`status.ts` 하나)
| status | 라벨 | tone |
|---|---|---|
| uploading | 업로드 중 | info |
| queued, waiting_for_document | 대기 중 | neutral |
| preprocessing | 변환 중(문서) / 전처리 중(작업) | info |
| running | 실행 중 (spinner) | info |
| paused, interrupted | 일시중단 | warning |
| cancel_requested | 중단 중 | warning |
| needs_review, uncertain, low_confidence | 검토 필요 | warning |
| completed, ready, present | 완료 / 준비 완료 / 있음 | success |
| completed_with_errors, incomplete, missing | 일부 실패 / 누락 있음 / 누락 | danger-soft |
| failed | 실패 | danger |
| canceled, deleted | 취소됨 / 원본 삭제 | neutral |
| unknown(분류) | 미분류 | warning |
- `<StatusBadge status>`를 쓰고, null이면 "–"를 표시한다. 카운터 순서는 전체 · 완료 · 검토 필요 · 실패 · (모듈별 추가)로 고정한다.
- **`JobStatusBar`:** 진행률과 "처리 n / N"을 보여주고, 버튼 순서는 [다음 검토 n][Export ▾][계속 처리 ▶][중단 ■ danger-outline]이다.
  - 문구는 "중단"으로 통일한다.
  - 폴링 중에는 "자동 갱신 중" 점을 표시한다.
  - 폴링 주기는 실행 중 1.5초, 대기 6초다.
  - 상태 바는 한 곳에만 둔다.

## B-4. 결과·검수와 Export
- **Main:** 공용 `DocumentViewer`(페이지, 줌, 맞춤, 회전, 영역, 썸네일)를 쓴다. `ModuleDocumentPreview`를 대체한다.
- **Side Result 카드:**
  - `ResultSummary`(상태, 주 값, 신뢰도)
  - `FilterChips`(전체 / 검토 필요 / 수정됨 / 경고)
  - `ResultTable`: 항목 · 값/상태(편집) · 신뢰도 · 근거 · 페이지(링크) · 검수
  - 하단 [수정 저장][Export ▾]
- **수정은 모든 모듈에서 명시적으로 저장한다.** dirty 표시와 SaveIndicator를 쓰고, 분류·필수항목의 즉시 PATCH는 없앤다.
- **`ExportMenu`** 하나로 단건과 배치를 모두 처리한다. 순서는 JSON / CSV / XLSX이고, 실패는 Toast로, 하단에 최근 export를 둔다. 분류와 필수항목에 단건 Export를 추가하고, 회전 보정에는 보정 결과 JSON을 추가한다.

## B-5. DefinitionEditor / DefinitionTable
- 구현은 `<table>` 하나로 한다. sticky 헤더, 행 최소 40px, textarea 자동 높이, 마지막 열은 IconButton(danger) 삭제다.
- 헤더는 [목록(Drawer)] [AI 추천] SaveIndicator로 구성하고, 자동 저장으로 통일한다.
- 열 구성:
  - Schema: 필드명 · 설명 · 타입 · 영역 · AI 검수
  - 분류: 클래스 · 설명 · 판단 신호
  - 필수항목: 항목 · 설명 · 증거 유형 · 필수 · 영역
- 영역 열은 공용 `RegionPicker` 모달로 지정한다. 숫자 입력은 "고급"으로 접는다.

## B-6. 공용 컴포넌트
Button(primary / secondary / ghost / danger / danger-outline × md 38 / sm 32), IconButton(aria-label 필수), Menu/SplitButton(Esc, 바깥 클릭, 방향키), StatusBadge / CountBadge, Dialog(sm / md / lg, focus trap, Esc, window.confirm 대체), Drawer, Toast, InlineAlert, EmptyState, SplitPane, Toolbar, PageHeader, StatCounter, ProgressBar, JobStatusBar.
- 제거 대상: `workflow-upload`, `rotation-upload-button`, `danger-plain`, `library-picker-trigger` 전용 스타일, 백드롭 3종.

## B-7. 토큰 (`styles/tokens.css`)
```css
--tds-gray-400:#b0b8c1; --tds-gray-800:#333d4b; --tds-blue-300:#64a8ff;
--tds-green-50:#e7f8f3; --tds-green-700:#007864; --tds-red-700:#c0303c;
--tds-shadow-soft:0 4px 14px rgba(25,31,40,.06); --tds-shadow-elevated:var(--tds-shadow-focus);
/* roles */ --color-bg/surface/surface-muted/border/border-strong/text/text-muted/text-subtle/accent/accent-hover/accent-soft
/* tones */ --tone-{success,warning,danger,info,neutral}-{bg,fg}
/* space */ 4 8 12 16 24 32   /* radius */ sm 8 · md 10 · lg 14 · xl 20 · pill
/* type  */ 11 12 13 14 16 20 28   /* icon */ 14 / 16 / 32   /* panel gap 12, card padding 16 */
```
- 녹회색 hex는 role 토큰으로 바꾼다. failed는 모두 danger tone이다.

## C. 구현 순서
1. 토큰, `status.ts`, StatusBadge를 만들고 버그 두 건(App:4049, App:2290/2307)을 고친다.
2. Menu, Toast, InlineAlert, Dialog, EmptyState, IconButton을 만든다. alert, confirm, status-card를 교체한다.
3. `DocumentInput`을 만들고 업로드 경로를 하나로 통일한다(중복 Preview와 runBatch 삭제).
4. ModuleWorkspace(분류·필수항목)를 먼저 옮기면서 ModulePage, PageHeader, JobStatusBar, ResultTable, ExportMenu, DefinitionTable을 확정한다.
5. 회전 보정을 옮긴다(좌우 정렬, SplitPane, 드롭·폴더 추가).
6. KIE를 옮긴다(BatchPanel 모달 제거, 중복 컨트롤 정리, SchemaBuilder를 DefinitionTable로).
7. 원문 추출을 옮긴다(백엔드 document_id 입력과 DocumentInput 단일 모드).
8. 보관함, Export 이력, 설정, 홈을 정리한다.
9. hex 개수를 다시 세고, 640px·980px 스크린샷으로 회귀를 확인한다.
