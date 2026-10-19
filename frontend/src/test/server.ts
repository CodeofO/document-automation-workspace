import { setupServer } from "msw/node";

// 테스트마다 server.use(...)로 핸들러를 붙인다.
export const server = setupServer();
