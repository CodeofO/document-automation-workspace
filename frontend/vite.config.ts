import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// 사내망 데모(scripts/run_lan_demo.sh)에서만 쓴다: `vite preview`가 /api를 기존 백엔드로 넘긴다.
const LAN_API_TARGET = process.env.LAN_API_TARGET;

// 로그인 없는 사내망 공개라, 설정 변경과 기록 일괄 삭제는 프록시에서 막는다.
function blockLanAdminWrites(): Plugin {
  const isBlocked = (method = "GET", url = "") =>
    url.startsWith("/api/maintenance") || (url.startsWith("/api/settings") && method !== "GET");
  return {
    name: "block-lan-admin-writes",
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!isBlocked(req.method, req.url)) return next();
        res.statusCode = 403;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ detail: "사내망 데모에서는 설정 변경과 기록 삭제를 할 수 없습니다." }));
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), ...(LAN_API_TARGET ? [blockLanAdminWrites()] : [])],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          return id.includes("node_modules") ? "vendor" : undefined;
        }
      }
    }
  },
  preview: LAN_API_TARGET ? { proxy: { "/api": { target: LAN_API_TARGET, changeOrigin: true } } } : undefined,
  server: {
    host: "127.0.0.1",
    port: 5173
  }
});
