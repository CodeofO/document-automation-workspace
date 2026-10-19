# 워크플로우 화면: 노드 선택 · Inspector 재설계 스펙

UX 자문(2026-10-15) 결과를 정리한 구현 스펙이다. 줄 번호는 재구성 전 `frontend/src/WorkflowBuilder.tsx` / `styles.css` 기준이다.

## 현재 문제
- **선택하면 곧 편집기가 열림.** `assetEditorNode = selectedNode && workflowNodeHasAssetEditor(selectedNode) && dismissed !== id`(:502-504)이기 때문이다. classifier/kie/required-checker 노드는 선택만 해도 880px × 68vh 플로팅 편집기(`styles.css:1388-1405`, z 36)가 캔버스를 거의 다 덮는다.
- **편집기를 여는 경로가 넷:**
  - 노드 div `onClick`(:2720)
  - React Flow select 변경(:671-685). 드래그만 해도 열린다.
  - `addNode`(:1408)
  - 워크플로우 불러오기·초기화·AI 초안 적용(:908, :921, :1537)
- **첫 진입부터 열림.** 초기 선택이 `defaultNodes[1]`(:438)이고, 로컬 초안이 `selectedNodeId`를 저장한다(:616).
- **닫아도 다시 열림.** X는 이번 한 번만 숨긴다(:1769). 선택이 바뀌면 dismiss 값이 리셋된다(:540-542).
- **같은 설정을 두 곳에서 바꿈.** 노드 카드 안 `<select>`(:2727-2746)가 편집기와 같은 에셋을 다룬다.
- **툴바가 밀림.** 선택/엣지 칩(:1692-1707)이 nowrap 툴바를 민다.
- **화면이 튐.**
  - fitView effect(:572-587)가 노드 수·사이드바·에셋 목록이 바뀔 때마다 120/360/760ms에 세 번 실행된다.
  - 실행 사이드바 토글로 캔버스 폭이 변한다.
  - 하단 검증 바 높이가 변한다.
- **죽은 코드:** `WorkflowRunProgressDock`, `WorkflowRunPreparingDock`(:2964-3067)은 렌더되지 않는다.

## 목표 인터랙션
| 동작 | 결과 |
|---|---|
| 클릭 | 선택과 하이라이트만 한다. 오른쪽 Inspector 내용만 바뀌고, 떠오르는 창은 없다 |
| Shift+클릭 | 다중 선택. Inspector에 "N개 선택" 요약과 일괄 삭제를 보여준다 |
| 드래그 | 이동만 한다 |
| 빈 곳 클릭 / Esc | 선택 해제. Drawer가 열려 있으면 Esc는 Drawer만 닫는다 |
| 엣지 클릭 | Inspector에 연결 정보, 분기 라벨, "선 삭제"를 보여준다(툴바 칩은 제거) |
| 더블클릭 | Inspector 설정의 첫 입력에 포커스를 준다(Drawer는 열지 않는다) |
| Enter / "에셋 편집" 버튼 | AssetEditorDrawer를 연다 |
| Delete / Backspace | 삭제 |
| ⌘/Ctrl+D | 복제 |
| ⌘/Ctrl+S | 저장 |
| ⌘/Ctrl+\ | 오른쪽 패널 접기/펴기 |
| F | fitView |

## 레이아웃
- **3열 grid:** 팔레트 | 캔버스 | RightPanel.
  - RightPanel은 기본 360px이고 320~560px로 조절할 수 있다.
  - 열은 항상 존재해서 선택해도 레이아웃이 움직이지 않는다.
  - 사용자가 접으면 40px 레일이 된다.
- **RightPanel 탭은 "속성 | 실행".** 기존 실행 현황 사이드바를 "실행" 탭으로 흡수한다. 실행이 시작되면 탭에 점과 숫자만 표시하고, 탭을 자동으로 전환하지 않는다.
- **선택이 없을 때는 WorkflowInspector를 보여준다:** 이름, 설명, 검증 요약(클릭하면 해당 노드 선택), 실행 문서.
- **NodeInspector** = 헤더(아이콘, 유형, 이름 편집, 복제, 삭제) + `inspectorRegistry[kind]` 섹션:
  - **에셋 노드:** 에셋 선택 드롭다운, 요약(개수와 상위 5개), "에셋 편집"과 "새 초안" 버튼
  - **branch:** 분기 키와 연결 상태
  - **rotation / merge / export:** 각 config 필드
  - **공통:** 검증 섹션
- **노드 카드 안 `<select>`는 제거한다.** 대신 읽기 전용 칩("스키마: 계약서 · 12필드")을 두고, 오른쪽 위에 배지(오류, 경고, ● 미저장 초안)를 단다.
- **AssetEditorDrawer:** 오른쪽 Drawer, 폭 `min(960px, 75vw)`, 반투명 백드롭. 기존 3종 편집기 본문(:1970-2488)을 `ClassifierAssetEditor`, `SchemaAssetEditor`, `ChecklistAssetEditor`로 나눠 옮긴다. 닫으면 선택은 유지된다.
- **하단 검증 바:** 높이를 고정한 한 줄 요약("오류 2 · 경고 1")으로 바꾸고, 클릭하면 워크플로우 Inspector를 연다. 일시 메시지는 토스트로 보낸다.
- **fitView:** 워크플로우를 불러오거나 AI 초안을 적용할 때(`viewportRevision`)만 실행한다.

## 상태
- `selection: {type:'none'} | {type:'nodes', ids} | {type:'edge', id}` 하나로 관리한다. React Flow `onSelectionChange`만 신뢰하고, 노드 div의 자체 onClick, Shift ref, ignore ref는 제거한다. `multiSelectionKeyCode="Shift"`.
- `rightPanel {tab, collapsed, width}`는 localStorage에 저장한다.
- `assetDrawer: {nodeId} | null`. 명시적으로 열 때만 값이 생긴다.
- `*DraftsByNodeId`는 Builder 상위에 유지하고 Drawer와 Inspector가 공유한다.
- `selectedNodeId`는 초기값과 로컬 초안 저장에서 제외한다. 화면 진입 시 항상 선택 없음으로 시작한다.

## 유지해야 할 기능
- **AI 초안 적용:** 노드를 자동 선택하지 않는다. 토스트와 해당 노드 배지만 남긴다.
- **저장·실행 시 초안 반영:** `materializeWorkflowDraftAssets`는 그대로 쓴다. 저장 후 미저장 배지가 사라지는지 확인한다.
- **그대로 둘 것:** 실행 큐·예약 버튼, 결과 창 해시 라우트(이후 react-router 라우트로 전환).
