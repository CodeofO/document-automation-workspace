import { CircleHelp, FileDown, Menu as MenuIcon, Settings, X } from "lucide-react";
import { useState } from "react";
import { Outlet, useLocation, useMatches, useNavigate } from "react-router";
import { Button, useMenu } from "../components/ui";
import { ProviderPill, SettingsDialog, useSystemStatus } from "../features/settings";
import { ROUTES } from "./routes";
import { TopbarSlotContext } from "./TopbarSlot";

export type RouteHandle = { title: string };

const DEFAULT_TITLE = "Document Automation Workspace";

/** 상단바(제목·VLM 상태·홈·설정·도움말) + 화면. */
export function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const matches = useMatches();
  const { open: menuOpen, ref: menuRef, toggle: toggleMenu, close: closeMenu } = useMenu();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [slotElement, setSlotElement] = useState<HTMLElement | null>(null);
  const { data: systemStatus } = useSystemStatus();
  const title =
    [...matches].reverse().map((match) => (match.handle as RouteHandle | undefined)?.title).find(Boolean) ?? DEFAULT_TITLE;
  const isHome = location.pathname === ROUTES.home;

  return (
    <TopbarSlotContext.Provider value={slotElement}>
      <div className="app-shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">Document Automation Workspace</p>
            <h1>{title}</h1>
          </div>
          <div className="topbar-action-shell" ref={menuRef}>
            <Button
              size="sm"
              className="mobile-topbar-menu-button"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-label="상단 메뉴"
              icon={menuOpen ? <X size={16} /> : <MenuIcon size={16} />}
              onClick={toggleMenu}
            >
              메뉴
            </Button>
            <div className={`status-strip ${menuOpen ? "mobile-open" : ""}`}>
              <ProviderPill status={systemStatus ?? null} />
              {!isHome && (
                <Button
                  size="sm"
                  onClick={() => {
                    closeMenu();
                    navigate(ROUTES.home);
                  }}
                >
                  홈
                </Button>
              )}
              <span className="topbar-page-slot" ref={setSlotElement} />
              {location.pathname !== ROUTES.exports && (
                <Button
                  size="sm"
                  icon={<FileDown size={16} />}
                  title="만든 CSV·JSON·XLSX 파일 다시 받기"
                  onClick={() => {
                    closeMenu();
                    navigate(ROUTES.exports);
                  }}
                >
                  Export 이력
                </Button>
              )}
              <Button
                size="sm"
                icon={<Settings size={16} />}
                title="VLM과 LibreOffice 설정"
                onClick={() => {
                  closeMenu();
                  setSettingsOpen(true);
                }}
              >
                설정
              </Button>
              <div className="help-trigger">
                <button type="button" className="help-button" aria-label="사용 가이드">
                  <CircleHelp size={18} />
                  <span className="help-button-label">도움말</span>
                </button>
                <div className="help-panel" role="tooltip">
                  <strong>사용 흐름</strong>
                  <span>문서를 업로드한 뒤 직접 schema를 정의하거나 AI 추천을 사용하세요.</span>
                  <span>Schema 변경은 필드 수정 후 자동 저장됩니다.</span>
                  <span>Export 전에 경고, 누락값, 수정값, 근거, 페이지를 검수하세요.</span>
                </div>
              </div>
            </div>
          </div>
        </header>
        <Outlet />
        <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </div>
    </TopbarSlotContext.Provider>
  );
}
