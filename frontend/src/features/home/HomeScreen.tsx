import { CheckSquare, ClipboardList, FileJson, FileUp, FolderOpen, RotateCw, Sparkles, Table2 } from "lucide-react";
import { EmptyState, ProgressBar, StatusBadge } from "../../components/ui";
import {
  homeMonitorCountText,
  homeMonitorStopReason,
  isActiveHomeStatus,
  isStoppedHomeStatus,
  type HomeMonitorItem
} from "./monitor";

export function HomeScreen(props: {
  onDocuments: () => void;
  onRaw: () => void;
  onKie: () => void;
  onTables: () => void;
  onClassifier: () => void;
  onRequiredChecker: () => void;
  onRotation: () => void;
  onWorkflow: () => void;
  showMonitor: boolean;
  monitorItems: HomeMonitorItem[];
  onOpenMonitorItem?: (item: HomeMonitorItem) => void;
}) {
  const monitorItems = props.monitorItems;
  const activeMonitorCount = monitorItems.filter((item) => isActiveHomeStatus(item.status)).length;

  return (
    <main className="home-screen">
      <section className={`home-hero home-hero-workflow ${props.showMonitor ? "" : "home-hero-workflow-no-monitor"}`}>
        <div className="home-hero-copy">
          <p className="eyebrow">작업 공간</p>
          <h2>문서 검수를 한 번에 자동화하세요</h2>
          <p>분류, 필수 항목 확인, 핵심 정보 추출, export를 하나의 워크플로우로 연결합니다.</p>
          <div className="home-hero-actions">
            <button type="button" className="primary home-workflow-cta" onClick={props.onWorkflow}>
              <FileJson size={18} />
              워크플로우 빌더 열기
            </button>
          </div>
          <div className="home-value-panel home-value-strip" aria-label="핵심 가치">
            <div className="home-value-card">
              <span>01</span>
              <strong>반복 분류 감소</strong>
              <p>문서 class 후보를 정해두고 접수 문서를 같은 기준으로 나눕니다.</p>
            </div>
            <div className="home-value-card">
              <span>02</span>
              <strong>누락 검수 빠르게</strong>
              <p>서명, 날짜, 체크박스처럼 빠지면 안 되는 항목을 먼저 확인합니다.</p>
            </div>
            <div className="home-value-card">
              <span>03</span>
              <strong>검수 결과 export</strong>
              <p>문서 이미지와 결과 table을 검수한 뒤 CSV, JSON, XLSX로 내보냅니다.</p>
            </div>
          </div>
        </div>
        {props.showMonitor && (
          <HomeMonitorPanel activeCount={activeMonitorCount} items={monitorItems} onOpen={props.onOpenMonitorItem} />
        )}
      </section>
      <div className="home-section-title">
        <p className="eyebrow">핵심 기능</p>
        <h3>필요한 작업을 바로 실행하거나 워크플로우에 연결하세요</h3>
      </div>
      {/* 카드 7개: 문서 보관함(모든 모듈의 입력)을 넓게 두고, 문서 준비(원문·회전) → 분석·검수(분류·KIE·표·필수 항목) 순.
          2열: 보관함 한 줄 + 3줄 × 2개, ≥1280px 4열: 보관함(2칸)+준비 2개 / 분석·검수 4개 — 빈 칸 없이 채운다. */}
      <section className="feature-grid" aria-label="핵심 기능">
        <button className="feature-card feature-card-wide active-feature" onClick={props.onDocuments}>
          <span className="feature-icon"><FolderOpen size={26} /></span>
          <div className="feature-heading">
            <strong>문서 보관함</strong>
            <span>Document Library</span>
          </div>
          <span>업로드와 변환을 백그라운드에서 처리하고 준비된 문서를 모든 작업에서 재사용합니다.</span>
          <div className="feature-points">
            <small>폴더 구조 유지</small>
            <small>준비되면 실행</small>
          </div>
        </button>
        <button className="feature-card active-feature" onClick={props.onRaw}>
          <span className="feature-icon"><FileUp size={26} /></span>
          <div className="feature-heading">
            <strong>원문 데이터 추출</strong>
            <span>Raw Data Extraction</span>
          </div>
          <span>DOCX, XLSX, PPTX, PDF를 PDF 미리보기와 HTML 원문으로 변환합니다.</span>
          <div className="feature-points">
            <small>Office preview</small>
            <small>HTML 원문 확인</small>
          </div>
        </button>
        <button className="feature-card active-feature" onClick={props.onRotation}>
          <span className="feature-icon"><RotateCw size={26} /></span>
          <div className="feature-heading">
            <strong>회전 보정</strong>
            <span>Rotation Correction</span>
          </div>
          <span>90°, 180°, 270° 돌아간 페이지를 감지해 보관함 문서의 페이지 이미지를 정방향으로 보정합니다.</span>
          <div className="feature-points">
            <small>회전 자동 감지</small>
            <small>수동 회전 보정</small>
          </div>
        </button>
        <button className="feature-card active-feature" onClick={props.onClassifier}>
          <span className="feature-icon"><ClipboardList size={26} /></span>
          <div className="feature-heading">
            <strong>문서 분류</strong>
            <span>Document Classification</span>
          </div>
          <span>정의한 class 후보 기준으로 문서를 분류합니다.</span>
          <div className="feature-points">
            <small>Class 후보 관리</small>
            <small>분류 결과 검수</small>
          </div>
        </button>
        <button className="feature-card active-feature" onClick={props.onKie}>
          <span className="feature-icon"><Sparkles size={26} /></span>
          <div className="feature-heading">
            <strong>핵심 정보 추출</strong>
            <span>Key Information Extraction</span>
          </div>
          <span>저장된 schema와 region 기준으로 필요한 field/value/evidence만 구조화합니다.</span>
          <div className="feature-points">
            <small>Schema library</small>
            <small>Region crop</small>
          </div>
        </button>
        <button className="feature-card active-feature" onClick={props.onTables}>
          <span className="feature-icon"><Table2 size={26} /></span>
          <div className="feature-heading">
            <strong>표 추출</strong>
            <span>Table Extraction</span>
          </div>
          <span>장부·일지처럼 행이 여러 개인 표를 행 단위 데이터로 옮깁니다.</span>
          <div className="feature-points">
            <small>표 영역 여러 개</small>
            <small>행·칸 검수</small>
          </div>
        </button>
        <button className="feature-card active-feature" onClick={props.onRequiredChecker}>
          <span className="feature-icon"><CheckSquare size={26} /></span>
          <div className="feature-heading">
            <strong>필수 항목 확인</strong>
            <span>Required Field Check</span>
          </div>
          <span>서명, 날짜, 체크박스, 도장처럼 빠지면 안 되는 항목의 존재 여부를 확인합니다.</span>
          <div className="feature-points">
            <small>AI checklist 추천</small>
            <small>누락/불확실 검수</small>
          </div>
        </button>
      </section>
    </main>
  );
}

/** 홈 오른쪽 "최근 실행" 패널. 행을 누르면 그 run·배치를 연다. */
export function HomeMonitorPanel(props: {
  activeCount: number;
  items: HomeMonitorItem[];
  onOpen?: (item: HomeMonitorItem) => void;
}) {
  return (
    <section className="home-monitor-panel ui-card" aria-label="진행 현황">
      <header className="ui-card-header">
        <div className="ui-card-heading">
          <p className="eyebrow">최근 실행</p>
          <h3>{props.activeCount ? `진행 중인 작업 ${props.activeCount}개` : "작업 진행 현황"}</h3>
        </div>
        {props.activeCount > 0 && (
          <span className="ui-job-status-live" role="status">
            <span className="ui-live-dot" aria-hidden />
            자동 갱신 중
          </span>
        )}
      </header>
      {props.items.length ? (
        <ul className="home-monitor-items">
          {props.items.map((item) => {
            const stopReason = homeMonitorStopReason(item);
            return (
              <li key={`${item.target}-${item.id}`}>
                <button
                  type="button"
                  className={`home-monitor-item ${isActiveHomeStatus(item.status) ? "active" : ""} ${isStoppedHomeStatus(item.status) ? "stopped" : ""}`}
                  onClick={() => props.onOpen?.(item)}
                >
                  <span className="home-monitor-item-head">
                    <span className="home-monitor-module">{item.moduleLabel}</span>
                    <StatusBadge status={item.status} />
                  </span>
                  <strong>{item.title}</strong>
                  <span className="home-monitor-counts">{homeMonitorCountText(item)}</span>
                  <ProgressBar value={item.progress} label={`${item.title} 진행률`} showLabel />
                  {stopReason && <span className="home-monitor-stop">{stopReason}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState compact title="실행 중인 작업이 없습니다.">
          워크플로우나 배치를 실행하면 여기에 표시됩니다.
        </EmptyState>
      )}
    </section>
  );
}
