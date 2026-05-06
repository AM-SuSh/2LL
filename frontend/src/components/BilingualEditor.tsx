import Editor from "@monaco-editor/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Toolbar } from "./Toolbar";
import { apiUrl } from "../utils/api";
import { exportBilingualMarkdown } from "../utils/exportMarkdown";
import { exportDomToPdf } from "../utils/exportPdf";

const STORAGE_KEY = "bilingual-editor-v1";

type Stored = {
  zhText: string;
  enText: string;
  updatedAt: string;
};

function loadFromStorage(): Stored | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as Stored;
    if (typeof j.zhText !== "string" || typeof j.enText !== "string") return null;
    return j;
  } catch {
    return null;
  }
}

function saveToStorage(zhText: string, enText: string) {
  const payload: Stored = {
    zhText,
    enText,
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function BilingualEditor() {
  const initial = useMemo(() => loadFromStorage(), []);
  const [zhText, setZhText] = useState(initial?.zhText ?? "# 中文标题\n\n在此输入中文 Markdown。");
  const [enText, setEnText] = useState(
    initial?.enText ?? "# English title\n\nEdit English here, or use **LLM translate**.",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastMock, setLastMock] = useState<boolean | null>(null);
  const pdfRootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => saveToStorage(zhText, enText), 400);
    return () => window.clearTimeout(t);
  }, [zhText, enText]);

  const canTranslate = zhText.trim().length > 0;

  const onTranslate = useCallback(async () => {
    setError(null);
    if (!canTranslate) return;
    setBusy(true);
    try {
      const res = await fetch(apiUrl("/api/translate"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: zhText }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        detail?: unknown;
        translated?: string;
        mock?: boolean;
      };
      if (!res.ok) {
        const detail =
          typeof data.detail === "string"
            ? data.detail
            : JSON.stringify(data.detail ?? res.statusText);
        throw new Error(detail || `HTTP ${res.status}`);
      }
      if (typeof data.translated !== "string" || !data.translated.trim()) {
        throw new Error("empty_translation");
      }
      setEnText(data.translated);
      setLastMock(Boolean(data.mock));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [canTranslate, zhText]);

  const onExportMd = useCallback(() => {
    setError(null);
    try {
      exportBilingualMarkdown(zhText, enText);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [zhText, enText]);

  const onExportPdf = useCallback(async () => {
    setError(null);
    const el = pdfRootRef.current;
    if (!el) {
      setError("pdf_target_missing");
      return;
    }
    setBusy(true);
    try {
      await exportDomToPdf(el, "bilingual");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="appShell">
      <Toolbar
        onTranslate={onTranslate}
        onExportMd={onExportMd}
        onExportPdf={onExportPdf}
        busy={busy}
        canTranslate={canTranslate}
        lastMock={lastMock}
      />

      {error && (
        <div className="banner banner--error" role="alert">
          <div className="banner__text">{error}</div>
          <button type="button" className="btn btn--small" onClick={() => setError(null)}>
            关闭
          </button>
        </div>
      )}

      <main className="grid2">
        <section className="pane">
          <div className="pane__head">中文</div>
          <div className="monacoWrap">
            <Editor
              height="100%"
              defaultLanguage="markdown"
              theme="vs"
              value={zhText}
              onChange={(v) => setZhText(v ?? "")}
              options={{
                minimap: { enabled: false },
                wordWrap: "on",
                fontSize: 14,
                scrollBeyondLastLine: false,
                automaticLayout: true,
              }}
            />
          </div>
        </section>

        <section className="pane">
          <div className="pane__head">English</div>
          <div className="monacoWrap">
            <Editor
              height="100%"
              defaultLanguage="markdown"
              theme="vs"
              value={enText}
              onChange={(v) => setEnText(v ?? "")}
              options={{
                minimap: { enabled: false },
                wordWrap: "on",
                fontSize: 14,
                scrollBeyondLastLine: false,
                automaticLayout: true,
              }}
            />
          </div>
        </section>
      </main>

      <section className="previewSection">
        <div className="previewSection__head">PDF 导出预览（内容与下方一致）</div>
        <div className="previewCard">
          {/* Capture target */}
          <div ref={pdfRootRef} className="pdfCaptureRoot">
            <h1 className="pdfTitle">双语对照稿</h1>
            <p className="pdfMeta">
              Exported from bilingual editor · {new Date().toLocaleString()}
            </p>

            <h2 className="pdfSectionTitle">中文</h2>
            <div className="md prose-zh">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{zhText}</ReactMarkdown>
            </div>

            <hr className="pdfHr" />

            <h2 className="pdfSectionTitle">English</h2>
            <div className="md prose-en">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{enText}</ReactMarkdown>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
