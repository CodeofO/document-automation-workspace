import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router";
import "@xyflow/react/dist/style.css";
import "../styles/index.css";
import { AppProviders } from "./providers";
import { createAppRouter } from "./router";

const router = createAppRouter();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </React.StrictMode>
);
