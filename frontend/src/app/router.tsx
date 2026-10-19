import { createBrowserRouter, Navigate, type RouteObject } from "react-router";
import { AppLayout, type RouteHandle } from "./AppLayout";
import { pathFromLegacyHash, ROUTES } from "./routes";

const handle = (title: string): RouteHandle => ({ title });

// 화면마다 코드를 나눠 불러온다(첫 화면 번들을 줄이고, 한 화면의 오류가 다른 화면을 막지 않게).
export const routes: RouteObject[] = [
  {
    element: <AppLayout />,
    // 첫 화면 코드를 불러오는 동안 빈 화면(SSR이 없어 잠깐이다).
    hydrateFallbackElement: <div className="app-shell" aria-busy="true" />,
    children: [
      {
        index: true,
        handle: handle("Document Automation Workspace"),
        lazy: async () => ({ Component: (await import("../pages/HomePage")).HomePage })
      },
      {
        path: ROUTES.documents,
        handle: handle("문서 보관함"),
        lazy: async () => ({ Component: (await import("../pages/DocumentsPage")).DocumentsPage })
      },
      {
        path: ROUTES.raw,
        handle: handle("원문 데이터 추출"),
        lazy: async () => ({ Component: (await import("../pages/RawExtractionPage")).RawExtractionPage })
      },
      {
        path: ROUTES.keyInfo,
        handle: handle("핵심 정보 추출"),
        lazy: async () => ({ Component: (await import("../pages/KeyInfoPage")).KeyInfoPage })
      },
      {
        path: ROUTES.classifier,
        handle: handle("문서 분류"),
        lazy: async () => ({ Component: (await import("../pages/ClassifierPage")).ClassifierPage })
      },
      {
        path: ROUTES.requiredCheck,
        handle: handle("필수 항목 확인"),
        lazy: async () => ({ Component: (await import("../pages/RequiredCheckPage")).RequiredCheckPage })
      },
      {
        path: ROUTES.rotation,
        handle: handle("회전 보정"),
        lazy: async () => ({ Component: (await import("../pages/RotationPage")).RotationPage })
      },
      {
        path: ROUTES.tables,
        handle: handle("표 추출"),
        lazy: async () => ({ Component: (await import("../pages/TablesPage")).TablesPage })
      },
      {
        path: `${ROUTES.tableTemplates}/:templateId?`,
        handle: handle("표 양식 편집"),
        lazy: async () => ({ Component: (await import("../pages/TableTemplatePage")).TableTemplatePage })
      },
      {
        path: `${ROUTES.workflows}/:workflowId?`,
        handle: handle("워크플로우 빌더"),
        lazy: async () => ({ Component: (await import("../pages/WorkflowPage")).WorkflowPage })
      },
      {
        path: "/workflow-runs/:runId",
        handle: handle("워크플로우 실행 결과"),
        lazy: async () => ({ Component: (await import("../pages/WorkflowRunPage")).WorkflowRunPage })
      },
      {
        path: ROUTES.exports,
        handle: handle("Export 이력"),
        lazy: async () => ({ Component: (await import("../pages/ExportsPage")).ExportsPage })
      },
      { path: "*", element: <Navigate to={ROUTES.home} replace /> }
    ]
  }
];

/**
 * 예전 해시 주소(#key-info, #workflow-result:<id>)로 들어오면 새 경로로 바꾼다.
 * 라우터를 만들기 전에 한 번 실행해 북마크를 살린다.
 */
export function migrateLegacyHash(): void {
  const path = pathFromLegacyHash(window.location.hash);
  if (path === null) return;
  window.history.replaceState(window.history.state, "", `${path}${window.location.search}`);
}

export function createAppRouter() {
  migrateLegacyHash();
  const router = createBrowserRouter(routes);
  // 아직 해시를 직접 바꾸는 코드가 남아 있어도 동작하도록, 실행 중 해시 변경도 경로로 옮긴다.
  window.addEventListener("hashchange", () => {
    const path = pathFromLegacyHash(window.location.hash);
    if (path !== null) void router.navigate(path, { replace: true });
  });
  return router;
}
