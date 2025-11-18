import React from "react";

import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";
import { ConvProvider } from "./context/ConvContext";
import { AlertProvider } from "./components/SmartAlertModal";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      {" "}
      {/* ✅ Router principale */}
      <ConvProvider>
        <AlertProvider>
          <App />
        </AlertProvider>
      </ConvProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
