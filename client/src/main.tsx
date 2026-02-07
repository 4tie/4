import { createRoot } from "react-dom/client";
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import App from "./App";
import "./index.css";

loader.config({ monaco });

createRoot(document.getElementById("root")!).render(<App />);
