# 표 추출(Table Extraction) API — 확정 계약 (backend part 1)

작성: 2026-10-19 (part 1 + part 2 구현 완료 기준) · 기준 설계: `docs/table-extraction-design.md` · 구현: `backend/app/table_schemas.py`(DTO), `backend/app/domain/table_spec.py`(정의), `backend/app/domain/table_normalization.py`(정규화·검증)

이 문서가 프론트엔드 기준이다. 타입은 `npm run gen:api`로 OpenAPI에서 생성할 수 있다(모델 이름은 아래와 같음). 설계 문서와 다른 점은 맨 아래 "설계 대비 차이"에 모았다.

part 1: 양식 CRUD, 단건·draft 실행, 결과 수정, 배치(from-documents). **part 2**(이 문서 §7~§9): export(배치·단건·export-jobs), 워크플로우 노드 `table`(+ 워크플로우 export 시트), AI 칼럼 초안(recommendations), 모델 응답의 칸 수 검증 완화(§5).

---

## 1. 정의 모델

### TableSpec
| 필드 | 타입 | 기본 | 규칙 |
|---|---|---|---|
| `key` | string | 필수 | 1~80자, 양식 안 유일 |
| `name` | string | 필수 | 1~120자 |
| `description` | string? | null | |
| `region` | `{x,y,width,height}`? | null | 페이지 비율 0~1, `x+width<=1`, `y+height<=1`. null = 페이지 전체 |
| `region_padding` | number | 0.05 | 0~0.5. **페이지 크기 비율**로 상하좌우에 더한다(아래 crop 규칙) |
| `end_hint` | string? | null | |
| `row_count` | `{mode, value}` | `{mode:"unknown", value:null}` | mode `exact`/`max`면 value(1~1000) 필수, `unknown`이면 value는 null로 저장 |
| `blank_rows` | `"skip"`/`"keep"` | `"skip"` | |
| `row_unit_hint` | string? | null | |
| `columns` | ColumnSpec[] | 필수 | 1~60개, key 유일 |
| `rules` | RuleSpec[] | [] | 참조 칼럼은 columns에 있어야 함 |

### ColumnSpec
| 필드 | 타입 | 기본 | 비고 |
|---|---|---|---|
| `key` | string | 필수 | 결과 열 이름 |
| `header_path` | string[] | [] | 최대 4단 |
| `description` | string? | null | |
| `type` | `text` `number` `date` `time` `choice` `checkbox` | `text` | |
| `choices` | string[] | [] | `choice`: 허용 값(유일). `choice`면 choices ≥1개 또는 `choice_allow_number=true` |
| `choice_allow_number` | bool | false | **추가**: choice 칼럼에 숫자도 허용(예: 잔량 = "완" 또는 숫자) |
| `checkbox_options` | string[] | [] | `checkbox`: 칸 이름 목록(유일) |
| `number_format` | `auto` `dot_decimal` `dot_thousands` | `auto` | **추가**: 숫자 구분자 해석(§5) |
| `keep_raw` | bool | true | 결과에는 항상 `raw`가 저장된다. false면 export의 `<칼럼>_원문` 열에서 빠진다(`include_raw=true`일 때도) |
| `ditto` | `fill_from_above` / `keep` | `fill_from_above` | |
| `required` | bool | false | 비면 행 `needs_review` + violation `required` |

### RuleSpec
| kind | 필드 | 의미 |
|---|---|---|
| `row_formula` | `expression`(필수), `tolerance`(기본 0.01, **절대 오차**), `message?` | `"주입중량 = 단중 * 실적"`. `=` 정확히 1개, `+ - * /`, 괄호, 숫자, 칼럼 key. 공백·연산자가 있는 key는 `[주입 수량]`처럼 대괄호. 피연산자가 비었거나 숫자가 아니면 그 행은 건너뜀 |
| `unique` | `columns`(≥1) | 칼럼 조합 값이 같은 데이터 행끼리 모두 위반 표시(값이 빈 행은 제외) |
| `row_count` | — | `TableSpec.row_count` 검사. 규칙 목록에 없어도 항상 평가된다 |

---

## 2. 양식(템플릿) API

| Method | Path | Body | 응답 |
|---|---|---|---|
| POST | `/api/table-templates` | `TableTemplateCreate` | `TableTemplateRead` |
| GET | `/api/table-templates?include_archived=false&include_ephemeral=false` | | `TableTemplateRead[]` (pinned 먼저, 최신순) |
| GET | `/api/table-templates/{id}` | | `TableTemplateRead` |
| PATCH | `/api/table-templates/{id}` | `TableTemplateUpdate` | `TableTemplateRead` |
| DELETE | `/api/table-templates/{id}` | | `TableTemplateRead` (`archived=true`) |
| POST | `/api/table-templates/{id}/duplicate` | | `TableTemplateRead` (이름 `"원본 (1)"`, version 1) |
| POST | `/api/table-templates/recommendations` | `TableRecommendationRequest` | `TableRecommendationRead` (§9) |

```jsonc
// TableTemplateCreate
{ "name": "샘플 생산 일지", "display_name": null, "description": null,
  "tables": [TableSpec, ...],          // 0개 허용(편집기 초안). 실행 시 0개면 422
  "sample_refs": [{"document_id": "doc_…", "page_number": 1}],   // 최대 10
  "pinned": false }

// TableTemplateUpdate — 모든 필드 선택. tables가 바뀌면 current_version += 1
{ "name"?, "display_name"?, "description"?, "tables"?, "sample_refs"?, "pinned"? }

// TableTemplateRead
{ "id": "table_template_…", "name", "display_name", "description", "current_version": 1,
  "tables": [TableSpec], "sample_refs": [SampleRef], "pinned", "ephemeral", "archived",
  "created_at", "updated_at" }
```
- 이름은 보관되지 않은(non-archived, non-ephemeral) 양식 사이에서 유일 → 중복 409.
- 보관된 양식은 수정 불가(409, 복제는 가능). draft(ephemeral) 양식은 수정·보관·복제 불가(400), GET은 가능. 보관된 양식으로 실행·배치하면 404.
- `TableRecommendationRequest` = `{document_id, page_number=1, region?, table_description?}`, `TableRecommendationRead` = `{table: TableSpec, reasoning?}` — 자세한 규칙은 §9.

---

## 3. 실행 API

| Method | Path | Body | 응답 |
|---|---|---|---|
| POST | `/api/table-extraction-jobs` | `{document_id, page_number?, template_id, table_keys?}` | `TableExtractionJobRead` |
| POST | `/api/table-extraction-jobs/draft` | `{document_id, page_number?, definition: {name?, tables: TableSpec[≥1]}, table_keys?}` | `TableExtractionJobRead` |
| GET | `/api/table-extraction-jobs?document_id=&limit=20` | | `TableExtractionJobRead[]` |
| GET | `/api/table-extraction-jobs/{job_id}` | | `TableExtractionJobRead` (result 포함) |
| PATCH | `/api/table-extraction-results/{result_id}` | `TableExtractionResultPatch` | `TableExtractionResultRead` |

- `page_number` 생략 규칙은 KIE 단건과 같다: 단일 페이지 문서 → 1페이지, 여러 페이지 문서 → 페이지마다 job, 응답은 1페이지 job + `page_jobs:[{job_id,page_number}]`. 변환 중 문서는 `waiting_for_document` placeholder(page_number null) 하나 → 변환 완료 시 페이지별로 펼쳐 실행. 없는 페이지 422.
- `table_keys`: 일부 표만 실행(미리보기). 모르는 key 422. 정의에 표가 0개여도 422.
- draft는 ephemeral 양식을 만들어 실행한다(목록에 안 보임). 응답의 `template_id`는 그 ephemeral 양식.
- job status: `waiting_for_document` `queued` `running` `completed` `needs_review` `failed` `canceled`. 표 하나라도 `needs_review`/`failed`면 job은 `needs_review`. 모든 표의 모델 호출이 실패하면 job `failed`.

```jsonc
// TableExtractionJobRead
{ "job_id": "table_job_…", "document_id", "page_number": 1,
  "template_id", "template_version": 3, "table_keys": null,
  "definition_snapshot": {"tables": [TableSpec]},   // 실행 시점 정의 사본
  "status", "error_message", "result_id", "result": TableExtractionResultRead | null,
  "created_at", "started_at", "completed_at", "page_jobs": [] }

// TableExtractionResultRead
{ "id": "table_result_…", "job_id",
  "raw_model_output": { "<table_key>": {headers_seen, rows, notes} | {"error": "…"} },
  "tables": [TableResult],             // 모델 결과 정규화·검증본(불변)
  "corrected_tables": [TableResult] | null,   // 사람 수정본(전체 표 사본). 있으면 화면·export는 이것 우선
  "edit_log": [TableEditLogEntry], "reviewed": false,
  "validation_warnings": ["injection_rows: …"],    // 표 경고를 "table_key: 메시지"로 모은 것
  "created_at", "updated_at" }
```

### TableResult
```jsonc
{ "table_key": "injection_rows", "table_name": "주입 내역",
  "status": "ok" | "needs_review" | "failed",
  "row_count": 6,                      // 데이터 행 수(빈 줄 제외)
  "expected_rows": {"mode": "max", "value": 16},
  "columns": ["수주처", "관리번호", …],  // 정의 순서
  "header_match": {"matched": 11, "missing": [], "extra": []} | null,
  "region_used": {"x", "y", "width", "height", "padding"} | null,   // 여백·clamp 반영된 실제 crop(페이지 비율). null = 페이지 전체
  "rows": [TableRow],
  "table_checks": [TableCheck],
  "warnings": ["…"], "model_notes": "…" | null,
  "error": null | "모델 호출 오류"       // status == failed일 때
}
// TableRow
{ "row_id": "r1",            // 결과 안 고정 id. 사람이 추가한 행은 "a1", "a2"…
  "row_index": 1 | null,     // 데이터 행 순번(빈 줄 제외, 빈 줄은 null)
  "source_line": 1 | null,   // 양식 줄 번호(빈 줄 포함, 모델 제공. 없으면 응답 순서)
  "y_center": 0.08 | null,   // region_used 안 세로 위치 0~1 (best effort)
  "status": "ok" | "needs_review" | "rejected",   // rejected는 예약(현재 생성 안 함)
  "flags": ["blank" | "cells_length_mismatch" | "added" | "edited"],
  "cells": { "<column key>": TableCell },
  "extra_cells": [TableCell],   // 칼럼 수보다 많이 온 칸(길이 불일치 때만)
  "violations": [{"rule": "row_formula|unique|required|cells_length_mismatch", "message", "columns": []}] }
// TableCell
{ "value": "MBS" | 21.696 | ["A1"] | null, "raw": "〃" | null, "confidence": 0.88 | null, "flags": [] }
// TableCheck
{ "rule": "row_count|row_formula|unique", "status": "ok|failed|skipped", "message"?,
  "expression"?, "columns": [], "expected"?, "actual"?, "violation_count": 0 }
```

### Cell flags
| flag | 의미 | 행 검토 필요? |
|---|---|---|
| `empty` | 빈 칸(raw null/공백) | 아니오(`required`면 예) |
| `ditto_resolved` | 〃 등 → 위 행 값으로 채움 | 아니오 |
| `ditto` | `ditto: keep` 칼럼의 〃(값 = 원문) | 아니오 |
| `ditto_unresolved` | 〃인데 위 행 값이 없음 | 예 |
| `uncertain_chars` | `?`(또는 `？`) 포함 | 예 |
| `low_confidence` | confidence < 0.6 | 예 |
| `type_mismatch` | number/date/time 변환 실패 | 예 |
| `choice_matched` / `choice_mismatch` | choice 허용 값 일치/불일치 | 불일치만 예 |
| `checkbox` | checkbox 칼럼(value = 표시된 칸 목록) | 아니오 |
| `checkbox_unknown_option` | 목록에 없는 칸 이름 | 예 |
| `number_in_choice` | `choice_allow_number`로 숫자 허용됨 | 아니오 |
| `ambiguous_separator` | 숫자 구분자 해석이 모호(§5) | 아니오(정보) |
| `thousands_separator` | 천 단위 구분자를 제거해 해석함 | 아니오(정보) |
| `partial_date` | 연도 없는 날짜(value `MM-DD`) | 아니오 |
| `unaligned` | 칸 수 불일치 행의 칸(위치 대응만 함) | 예(행 단위) |
| `corrected` | 사람이 수정한 칸(confidence 1.0) | — |
| `extra` | `extra_cells`의 칸(칼럼 밖, value null) | — |

화면 색 기준(설계 §7): confidence < 0.8 노랑, < 0.6 빨강. 서버는 < 0.6만 `low_confidence`로 검토 대상에 넣는다.

### 결과 수정 PATCH
```jsonc
// TableExtractionResultPatch — 모든 row 참조는 PATCH 이전 상태 기준
{ "edits": [{"table_key", "row_id"? , "row_index"?, "column", "value"}],
  "add_rows": [{"table_key", "after_row_id"?, "after_row_index"?, "cells": {"칼럼": "값"}}],
  "delete_rows": [{"table_key", "row_id"?, "row_index"?}],
  "reviewed": true? }
```
- 대상은 `corrected_tables`가 있으면 그것, 없으면 `tables`의 사본. 적용 순서: edits → delete_rows → add_rows → 행 번호 재계산 → **전체 재검증**(칸 정규화·〃·규칙·행 수·상태).
- 행 지정은 `row_id` 우선, 없으면 `row_index`(데이터 행 번호). 빈 줄 행은 `row_id`로만 지정 가능.
- `value`는 사람이 입력한 텍스트로 보고 칼럼 형식으로 다시 정규화한다(`"1,234"` → 1234). 칸에 `corrected` flag, confidence 1.0, 행에 `edited` flag. 수정이 있었던 행은 `cells_length_mismatch` 위반을 해제한다(사람이 확인한 것으로 간주).
- `add_rows`: `after_row_id`/`after_row_index`(0 = 맨 위) 둘 다 없으면 맨 끝. 새 행은 `row_id` `a1…`, flag `added`, 칸 `corrected`.
- 모르는 table_key/row/column → 422. 응답은 갱신된 `TableExtractionResultRead`. job status는 바꾸지 않는다.
- `edit_log` 항목: `{at(ISO 문자열), action: edit|add_row|delete_row|reviewed, table_key, row_id, row_index, column, before, after}`. `edit`: before = 이전 value, after = 입력값. `delete_row`: before = `{칼럼: value}`. `add_row`: after = 입력 cells. `reviewed`: after = bool.

---

## 4. 배치 API (분류 배치와 같은 계약)

| Method | Path | Body/Query | 응답 |
|---|---|---|---|
| POST | `/api/table-extraction-batches/from-documents` | `{template_id, document_ids: string[]}` | `TableExtractionBatchRead` |
| GET | `/api/table-extraction-batches?limit=20&include_items=true` | | `TableExtractionBatchRead[]` |
| GET | `/api/table-extraction-batches/{id}` | | `TableExtractionBatchRead` |
| GET | `/api/table-extraction-batches/{id}/summary` | | `TableExtractionBatchRead` (items 빈 배열, 카운터만) |
| POST | `/api/table-extraction-batches/{id}/cancel` | | `TableExtractionBatchRead` |
| POST | `/api/table-extraction-batches/{id}/discard` | | `TableExtractionBatchRead` |
| POST | `/api/table-extraction-batches/{id}/resume` | | `TableExtractionBatchRead` |

```jsonc
// TableExtractionBatchRead
{ "id": "table_batch_…", "template_id", "template_version", "status",
  "total_count", "completed_count", "failed_count", "canceled_count", "uploaded_count",
  "preprocessing_count", "ready_count", "queued_count", "running_count", "needs_review_count",
  "progress_phase", "progress",
  "items": [{ "id", "document_id", "page_number", "job_id", "filename", "upload_index",
              "status", "result_id", "error_message", "created_at" }],
  "created_at", "completed_at" }
```
- 페이지마다 item/job 하나(`total_count` = 페이지 수). 배치 생성 시점의 양식 정의가 모든 job의 `definition_snapshot`이 된다(배치에 `template_version`·`definition_snapshot` 저장).
- 결과는 item의 `job_id`로 `GET /api/table-extraction-jobs/{job_id}`.
- export: `GET /api/table-extraction-batches/{id}/export` (§7).

---

## 5. 정규화 규칙(서버)

모델은 칸마다 `raw`(보이는 그대로)와 `conf`만 낸다. 나머지는 서버가 한다(`app/domain/table_normalization.py`).

- 공통: 앞뒤 공백 제거, 빈 문자열 → `empty`. `?`/`？` 포함 → `uncertain_chars`(number/date/time은 value null, `type_mismatch`는 붙이지 않음).
- 〃 판정 문자열: `〃 " ″ ” “ '' ゝ ゞ 々 同上 상동`. `fill_from_above`면 바로 위 **데이터 행**의 같은 칼럼 정규화 값(이미 〃로 채운 값 포함)을 쓰고 confidence는 둘 중 작은 값.
- text: value = raw.
- number(`number_format`):
  - 전처리: NFKC(전각 숫자), 공백 제거, 앞 부호 허용. 숫자·`.`·`,` 외 문자가 있으면 `type_mismatch`.
  - `auto`(기본):
    - `.`과 `,`가 모두 있으면 뒤에 나온 것이 소수점, 앞의 것은 천 단위(`1,234.5`→1234.5, `1.234,5`→1234.5) + `thousands_separator`.
    - `,`만: `^\d{1,3}(,\d{3})+$`면 천 단위(`1,234`→1234), 아니면 소수점 쉼표(`21,5`→21.5) + `ambiguous_separator`.
    - `.`만 여러 개: `^\d{1,3}(\.\d{3})+$`면 천 단위 점(`1.234.567`→1234567) + `thousands_separator`, 아니면 `type_mismatch`.
    - **`.` 하나 + 뒤 정확히 3자리(`21.696`)**: 소수로 해석(value 21.696) + `ambiguous_separator`. raw `"21.696"`은 그대로 보존된다. 천 단위 점을 쓰는 칼럼은 `number_format: "dot_thousands"`로 지정하면 21696.
  - `dot_decimal`: `.` 소수점, `,` 천 단위(그룹 형식 검사).
  - `dot_thousands`: `.` 천 단위, `,` 소수점.
- date: `YYYY-MM-DD`, `YYYY.MM.DD`, `YYYY/MM/DD`, `YY.MM.DD`(20YY), `YYYY년 M월 D일`, `M/D`·`M.D`·`M월 D일`(연도 없음 → value `MM-DD` + `partial_date`). 끝의 `.` 허용. 그 외·없는 날짜 → `type_mismatch`. value는 ISO `YYYY-MM-DD`.
- time: `H:MM`, `H:MM:SS`, `H.MM`, `HHMM`(4자리), `H시 M분`, `H시`. 범위 검사(24:00 허용). value `HH:MM` 또는 `HH:MM:SS`.
- choice: NFKC·대소문자 무시 일치 → value = 정의된 choice + `choice_matched`. 아니면 `choice_allow_number`이고 숫자면 value = 숫자 + `number_in_choice`. 그 외 value null + `choice_mismatch`.
- checkbox: raw를 `, ; / 공백`으로 나눈 토큰. `A1:1`/`A1=1`/`A1:✓`은 표시, `:0`·`=0`은 미표시. 옵션 목록이 있으면 옵션 순서로 value, 목록에 없는 토큰 → `checkbox_unknown_option`. 목록이 없으면 토큰 그대로. 항상 `checkbox` flag. 빈 칸 → value `[]` + `empty`.
- 빈 행: 모든 칸이 비면 빈 줄. `skip`이면 결과에서 뺀다(다른 행의 `source_line`은 유지), `keep`이면 `flags:["blank"]`, `row_index` null, 검증 제외.
- 칸 수 불일치: 모델 호출은 **관대하게 검증**한다. 출력 스키마는 plain JSON schema(dict)이고 `cells`의 `minItems = maxItems = 칼럼 수`는 공급자에게 주는 안내일 뿐이다(OpenAI strict json_schema, Gemini `response_json_schema`, 로컬 raw JSON 프롬프트). 응답은 pydantic/langchain 검증 없이 plain dict로 파싱하므로 길이가 달라도 호출이 실패하지 않는다. 공급자가 `minItems`/`maxItems`(또는 스키마)를 거부하는 오류를 내면 두 키워드를 뺀 스키마로 **1회 재시도**한다.
- 모델이 칼럼 수와 다른 길이의 `cells`를 내면 그 행은 `needs_review` + flag `cells_length_mismatch` + violation `cells_length_mismatch` + 표 경고. 칸은 앞에서부터 위치대로만 대응하고(`unaligned` flag), 모자란 칸은 `empty`, 남는 칸은 `extra_cells`에 둔다. 값을 옮기거나 버리지 않는다.

### 상태 기준
- 행 `needs_review`: violation이 하나라도 있거나, 칸에 `type_mismatch` `choice_mismatch` `uncertain_chars` `low_confidence` `ditto_unresolved` `checkbox_unknown_option` `unaligned` 중 하나가 있을 때.
- 표 `needs_review`: 검토 행이 있거나, `table_checks` 중 failed가 있거나, 데이터 행이 0개(경고 "No rows were extracted")일 때. 모델 호출 실패 → 표 `failed`.
- job `needs_review`: 표 중 `ok`가 아닌 것이 있을 때. 모든 표 `failed` → job `failed`.
- 임계값: `LOW_CONFIDENCE_THRESHOLD = 0.6`(서버 검토), `REVIEW_CONFIDENCE_THRESHOLD = 0.8`(화면 노랑·export `검토_칸` 기준).

### crop 규칙
- 이미지: 실행 시점의 `DocumentPage.image_path`(회전 보정 반영본).
- 영역 있음: `x-padding, y-padding, x+width+padding, y+height+padding`(페이지 비율)을 [0,1]로 clamp → 원해상도 crop(확대·보정 없음) + 긴 변 1024px 축소 전체 페이지. `region_used`는 clamp 후 비율.
- 영역 없음: 원해상도 전체 페이지 1장, `region_used` null.
- 표마다 VLM 호출 1회, 한 페이지의 표들은 동시에 호출(전역 VLM 동시 호출 제한 `VLM_MAX_CONCURRENT_REQUESTS` 적용).

---

## 6. 설계 대비 차이

| 항목 | 설계 | 구현 |
|---|---|---|
| workspace 범위 | `workspace.scope_query` 적용 | 리팩터에서 workspace 범위 기능이 제거됨. `workspace_id` 컬럼만 둔다(항상 null) |
| PATCH version | 수정 시 +1 | **`tables`가 실제로 바뀔 때만** +1(이름·고정·샘플만 바꾸면 그대로). 자동 저장이 버전을 불리지 않게 |
| 템플릿 표 개수 | — | 저장은 0개 허용(편집기 초안), 실행은 ≥1 필요(422) |
| ColumnSpec | — | `choice_allow_number`, `number_format` 추가 |
| keep_raw | 원문 보존 | `raw`는 항상 저장. `keep_raw`는 export 원문 열(`include_raw`) 포함 여부 |
| RuleSpec | tolerance 0.01 | tolerance는 **절대 오차**. `unique`는 `columns` 배열(복합 key 가능). `message` 선택 |
| TableResult | | `model_notes`, `error`, 표 status `failed` 추가 |
| 행 | `row_index` | 고정 `row_id`, `flags`, `extra_cells` 추가. PATCH는 `row_id` 우선 |
| `header_match` | | 모델이 `headers_seen`(보이는 머리글 텍스트)을 함께 내고 서버가 계산. 머리글이 안 보이면 null |
| 배치 테이블 | 분류 배치 + template_id | + `template_version`, `definition_snapshot`(배치 생성 시점 정의를 모든 페이지 job에 동일 적용) |
| 배치 생성 | from-documents | from-documents만(업로드 기반 `init/items/start`는 없음. 업로드는 `/api/library/uploads` 후 from-documents) |
| job 목록 | — | `GET /api/table-extraction-jobs?document_id=` 추가 |
| region_padding | 5% | 페이지 크기 비율로 해석 |
| recommendations | AI 초안 | 구현(§9). `row_count_guess` → `row_count {mode:"max"}`. choices 없는 choice 칼럼은 text로 |
| 칸 수 강제 | 스키마로 minItems = maxItems 강제 | 스키마에는 **안내용**으로만 넣고 응답은 plain dict로 받아 길이 검증을 하지 않는다. 길이가 다르면 항상 행 `needs_review` + 경고(표 실패 아님). 공급자가 minItems/maxItems를 거부하면 그 키워드를 빼고 1회 재시도 |
| export 검토 칸 | 신뢰도<0.8·flag 있는 칸 | flag 중 `empty` `checkbox` `choice_matched` `corrected`만 있는 칸은 제외(종류 표시·확정 상태라서). 빈 필수 칸은 `검증_위반`의 `required`로 나온다 |
| export csv | 표별 CSV zip | + `검토_칸.csv`, `검증_위반.csv` 함께 |
| export-jobs 옵션 | — | `POST /api/export-jobs`(owner_type `table_extraction_batch`)는 `include_raw`/`include_confidence`를 받지 않는다(항상 false). 옵션이 필요하면 동기 GET export 사용 |
| 워크플로우 CSV | — | 한 파일(항목당 1행) 유지. 표 행은 넣지 않고 `table_<key>_rows`/`table_<key>_status` 요약 열만. 표 행은 XLSX·JSON에서 |


---

## 7. Export (part 2)

| Method | Path | Query | 응답 |
|---|---|---|---|
| GET | `/api/table-extraction-batches/{id}/export` | `format=xlsx`(기본)`\|csv\|json`, `include_raw=false`, `include_confidence=false` | 파일 다운로드 |
| GET | `/api/table-extraction-jobs/{job_id}/export` | 동일 | 파일 다운로드(검토 화면용, 페이지 1개). result가 없으면 **409** |
| POST | `/api/export-jobs` | body `{owner_type: "table_extraction_batch", owner_id, format}` | 비동기 export job(기존 계약). 옵션은 항상 false |
| GET | `/api/export-jobs?owner_type=table_extraction_batch&owner_id=…` | | 기존 계약 |

공통 규칙
- 사람 수정본 우선: result의 `corrected_tables`가 있으면 그것, 없으면 `tables`.
- 값: 칸 `value`(정규화값). checkbox 목록은 `"A1;A3"`, null은 빈 칸. 숫자는 숫자 셀.
- 파일 이름: `table_<양식이름>_<batch_id|job_id>.<xlsx|zip|json>` (`Content-Disposition`에 UTF-8 이름).

### xlsx (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`)
시트 순서: **표 스키마마다 1개**(정의 순서, 행이 없어도 머리글만 있는 시트) → `검토_칸` → `검증_위반`.
- 표 시트 이름 = 표 `name`. `[ ] : * ? / \` → `_`, 31자 자르기, 중복(대소문자 무시)이면 `"이름 (2)"`(31자 안에 맞춤). `검토_칸`·`검증_위반`(워크플로우는 `Export`도) 이름과 겹치면 `(2)`. 빈 이름 → 표 key.
- 표 시트 열: `파일, 페이지, 행번호`, 그다음 칼럼마다 `<칼럼>` [+ `<칼럼>_원문`(include_raw이고 keep_raw=true일 때)] [+ `<칼럼>_신뢰도`(include_confidence)]. 행번호 = `row_index`(keep 빈 줄은 빈 칸). 행 순서: 파일 업로드 순 → 페이지 → 표 안 행 순.
- `검토_칸` 열: `파일, 페이지, 표, 행번호, 칼럼, 값, 원문, 신뢰도, flags`(flags는 `;`로 연결). 대상: confidence < 0.8 이거나, `empty` `checkbox` `choice_matched` `corrected` **이외의** flag가 하나라도 있는 칸. `extra_cells`(칸 수 초과분)는 칼럼 `"(추가 칸 n)"`으로 들어간다.
- `검증_위반` 열: `파일, 페이지, 표, 행번호, 규칙, 내용`. 규칙: 행 violation(`row_formula` `unique` `required` `cells_length_mismatch`), 표 검사 `row_count`(행번호 빈 칸), `table_failed`(모델 호출 실패 표), 페이지 단위 `job_failed` `job_canceled` `no_result` `job_missing`(표 빈 칸).

### csv (`application/zip`)
zip 안에 표마다 `<시트 이름>.csv` + `검토_칸.csv` + `검증_위반.csv`. 모두 UTF-8 BOM(utf-8-sig), 열 구성은 xlsx 시트와 같다.

### json (`application/json`)
```jsonc
// 배치
{ "batch_id", "template_id", "template_name", "template_version", "status", "total_count",
  "pages": [{ "filename", "page_number", "document_id", "job_id", "status", "error_message",
              "result_id", "reviewed": false, "corrected": true,   // corrected = corrected_tables 사용 여부
              "tables": [TableResult] }] }                         // §3 TableResult 그대로(수정본 우선)
// 단건 job
{ "template_id", "template_name", "template_version",
  "filename", "page_number", "document_id", "job_id", "status", "error_message", "result_id", "reviewed", "corrected", "tables": [TableResult] }
```
`include_raw`/`include_confidence`는 json에 영향 없음(TableResult에 raw·confidence가 이미 있다).

---

## 8. 워크플로우 노드 `table` (part 2)

```jsonc
{ "id": "table_1", "data": { "kind": "table", "label": "표 추출",
  "config": { "template_id": "table_template_…", "table_keys": ["injection_rows"] } } }   // table_keys 선택(null/생략 = 전체)
```
- kind 별칭: `table-extraction`, `table_extraction` → `table`.
- 연결 규칙: KIE와 같은 단일 출력 노드(나가는 edge ≤ 1). 분기(branch) 하위에 둘 수 있다.
- 저장·실행 시 검증(422 `detail`에 메시지): `Table node {id} must select a saved table template`(없음·보관·draft 양식), `Table node {id}: Unknown table key(s): …`, `Table node {id}: the table template has no tables to extract`.
- 실행: 실행 항목(=페이지)마다 table job 1개를 만든다. `definition_snapshot` = **실행 시점** 양식 정의, `template_version` = 그때 버전, `page_number` = 항목 페이지(없으면 1). 실행 엔진·VLM 동시 호출 제한·정규화는 단독 실행과 동일. 일시정지/중지/재시작 의미는 KIE 노드와 같다(중지 시 진행 중 table job은 `canceled`, 재시작하면 새 job).
- 항목 상태: table job이 `needs_review`면 항목 `needs_review`, `failed`(또는 결과 없음)면 항목 `failed`(이후 노드 실행 안 함).
- `node_results[<node id>]`:
```jsonc
{ "kind": "table", "status": "completed" | "needs_review" | "failed",
  "job_id": "table_job_…", "result_id": "table_result_…" | null,
  "template_id", "template_version": 3,
  "tables": [{ "key": "injection_rows", "name": "주입 내역", "status": "ok|needs_review|failed",
               "row_count": 6, "review_cells": 2, "violations": 1 }],   // review_cells·violations = export 검토_칸·검증_위반 기준 개수
  "error_message": null }
```
  상세 행은 `GET /api/table-extraction-jobs/{job_id}`로 조회. 결과 화면에서 사람이 PATCH로 고치면 export에는 반영되지만 `node_results.tables` 요약은 실행 시점 값 그대로다.

### 워크플로우 export (`GET /api/workflow-runs/{id}/export`, export-jobs `workflow_run`)
표 노드가 **없는** 워크플로우는 이전과 완전히 같다. 표 노드가 있으면:
- 항목 행(모든 형식)에 표마다 `table_<table_key>_rows`, `table_<table_key>_status` 열 추가.
- **xlsx**: 기존 `Export` 시트(KIE union 열) 뒤에 **(양식, 표 key)마다 시트 1개**(열 `파일, 페이지, 행번호, 칼럼…`, 여러 항목의 행을 모음) → `검토_칸` → `검증_위반`. 시트 이름 규칙은 §7과 같다(같은 이름이면 `(2)`).
- **json**: 최상위 `tables` 추가(표 노드 없으면 키 자체가 없음):
```jsonc
"tables": [{ "template_id", "template_name", "table_key", "table_name", "columns": ["품명", …],
             "rows": [{ "filename", "page_number", "document_id", "job_id", "workflow_run_item_id",
                        "row_id", "row_index", "status",
                        "values": {"품명": "MBS", "레들": ["A1"]},       // 정규화 값(목록은 목록 그대로)
                        "cells": {"품명": TableCell}, "violations": [] }] }]
```
- **csv**: 한 파일(항목당 1행)을 유지한다. 표마다 열 구성이 달라 표 행은 넣지 않고 위의 요약 열만 둔다. 표 행이 필요하면 xlsx/json.

---

## 9. AI 칼럼 초안 `POST /api/table-templates/recommendations` (part 2)

```jsonc
// TableRecommendationRequest
{ "document_id": "doc_…", "page_number": 1, "region": {"x","y","width","height"} | null, "table_description": "수주처별 주입 기록" | null }
// TableRecommendationRead
{ "table": TableSpec, "reasoning": "…" | null }
```
- VLM 호출 1회(동기 응답). 이미지: region이 있으면 region + 여백 5%(페이지 비율, clamp) 원해상도 crop + 긴 변 1024px 전체 페이지 축소본, 없으면 전체 페이지 1장(실행 시와 같은 crop 규칙, 회전 보정 반영 이미지).
- 돌려주는 `table`은 검증된 `TableSpec` 초안이라 그대로 양식 `tables`에 넣어 저장할 수 있다:
  - `key`: 모델 key(없으면 name)를 공백·기호 → `_`로 바꾼 것(최대 80자, 비면 `table_1`). `name`: 공백 정리(비면 `"표 1"`). `description`: 모델 값, 없으면 요청의 `table_description`.
  - `region`: 요청 region 그대로(null 가능). `end_hint`, `row_unit_hint`: 모델 값(빈 문자열 → null).
  - `row_count`: 모델 `row_count_guess`가 1~1000 정수면 `{mode:"max", value}`, 아니면 `{mode:"unknown"}`.
  - `columns`(최대 60): key는 공백 정리 후 중복이면 `수량_2`…, 비면 header_path 마지막 텍스트 또는 `칼럼{n}`. `header_path` 최대 4단(빈 값 제거). `type`이 6종 밖이면 `text`. `choice`인데 choices가 없으면 `text`. choices/checkbox_options는 해당 형식일 때만, 중복 제거. 나머지 ColumnSpec 필드는 기본값.
  - `rules`는 비어 있다.
- 오류: 문서 없음 404, 페이지 없음 422, VLM 오류 400(`detail`은 다른 추천 API와 같은 VLM 오류 형식), 칼럼을 하나도 못 찾음 502.
- mock 공급자(`VLM_PROVIDER=mock`): 결정적 3칼럼 초안 — `key "work_rows"`, `name "작업 내역"`, 칼럼 `품명`(text, `["품명"]`), `수량`(number, `["실적","수량"]`), `작업일`(date), `end_hint "'합계' 줄 위까지"`, `row_count {max, 10}`.
