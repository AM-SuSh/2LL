import { BilingualEditor, PreviewPage, SettingsPage } from "./components/BilingualEditor";
import "./App.css";

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const page = params.get("page") || "editor";
  if (page === "preview") return <PreviewPage />;
  if (page === "settings") return <SettingsPage />;
  return <BilingualEditor />;
}
