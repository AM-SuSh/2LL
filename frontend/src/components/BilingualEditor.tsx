import Editor, { OnMount } from "@monaco-editor/react";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { DualColumnPreview } from "./DualColumnPreview";
import { apiUrl } from "../utils/api";
import { buildRowPairs } from "../utils/dualColumn";
import { exportDomToPdf } from "../utils/exportPdf";
import {
  DEFAULT_DOC_TITLE,
  LlmConfig,
  PREVIEW_STORAGE_KEY,
  loadLlmSettings,
  loadPreviewPayload,
  saveLlmSettings,
  savePreviewPayload,
} from "../utils/previewBridge";

type TranslateResponse = {
  translated: string;
  mock?: boolean;
};

const ZH_STORAGE_KEY = "bilingual-editor-zh-v1";
const EN_STORAGE_KEY = "bilingual-editor-en-v1";
const TITLE_STORAGE_KEY = "bilingual-editor-title-v1";
const LOCAL_IMAGES_KEY = "bilingual-editor-images-v1";

function loadLocalImages(): Map<string, string> {
  try {
    const raw = localStorage.getItem(LOCAL_IMAGES_KEY);
    if (!raw) return new Map();
    const obj = JSON.parse(raw) as Record<string, string>;
    return new Map(Object.entries(obj));
  } catch {
    return new Map();
  }
}

function saveLocalImages(images: Map<string, string>): void {
  const obj: Record<string, string> = {};
  images.forEach((value, key) => {
    obj[key] = value;
  });
  localStorage.setItem(LOCAL_IMAGES_KEY, JSON.stringify(obj));
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function generateImageKey(fileName: string): string {
  const timestamp = Date.now();
  const safeName = fileName.replace(/[^a-zA-Z0-9.-]/g, "_");
  return `local://${timestamp}-${safeName}`;
}
function isoToLocal(iso: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
}

function toPage(page: "editor" | "preview" | "settings") {
  window.location.href = `${window.location.pathname}?page=${page}`;
}

function getInitialTexts() {
  const fromPreview = loadPreviewPayload();
  if (fromPreview) {
    return {
      zh: fromPreview.zhText,
      en: fromPreview.enText,
      title:
        fromPreview.title ??
        localStorage.getItem(TITLE_STORAGE_KEY) ??
        DEFAULT_DOC_TITLE,
    };
  }
  return {
    zh: localStorage.getItem(ZH_STORAGE_KEY) ?? "",
    en: localStorage.getItem(EN_STORAGE_KEY) ?? "",
    title: localStorage.getItem(TITLE_STORAGE_KEY) ?? DEFAULT_DOC_TITLE,
  };
}

const SCROLL_MODE_KEY = "bilingual-editor-scroll-mode-v1";

type ScrollMode = "independent" | "sync-line";

export function BilingualEditor() {
  const initial = getInitialTexts();
  const [zhText, setZhText] = useState(initial.zh);
  const [enText, setEnText] = useState(initial.en);
  const [docTitle, setDocTitle] = useState(initial.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lastSyncAt, setLastSyncAt] = useState(new Date().toISOString());
  const [localImages, setLocalImages] = useState<Map<string, string>>(() => loadLocalImages());
  const [scrollMode, setScrollMode] = useState<ScrollMode>(() => {
    const stored = localStorage.getItem(SCROLL_MODE_KEY);
    if (stored === "sync-line") return "sync-line";
    return "independent";
  });

  const zhEditorRef = useRef<any>(null);
  const enEditorRef = useRef<any>(null);
  const activePaneRef = useRef<"zh" | "en">("zh");
  const pdfCaptureRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isScrollingSyncRef = useRef(false);

  const pairCount = useMemo(() => buildRowPairs(zhText, enText).length, [zhText, enText]);

  useEffect(() => {
    localStorage.setItem(ZH_STORAGE_KEY, zhText);
    localStorage.setItem(EN_STORAGE_KEY, enText);
    localStorage.setItem(TITLE_STORAGE_KEY, docTitle);
    const now = new Date().toISOString();
    setLastSyncAt(now);
    savePreviewPayload({ zhText, enText, updatedAt: now, title: docTitle });
  }, [zhText, enText, docTitle]);

  useEffect(() => {
    saveLocalImages(localImages);
  }, [localImages]);

  useEffect(() => {
    localStorage.setItem(SCROLL_MODE_KEY, scrollMode);
  }, [scrollMode]);

  const scrollModeRef = useRef(scrollMode);
  useEffect(() => {
    scrollModeRef.current = scrollMode;
  }, [scrollMode]);

  const alignByLine = useCallback((source: "zh" | "en") => {
    if (scrollModeRef.current !== "sync-line" || isScrollingSyncRef.current) return;

    const sourceEditor = source === "zh" ? zhEditorRef.current : enEditorRef.current;
    const targetEditor = source === "zh" ? enEditorRef.current : zhEditorRef.current;
    if (!sourceEditor || !targetEditor) return;

    const ranges = sourceEditor.getVisibleRanges?.();
    let topLine = 1;
    if (ranges && ranges.length > 0) {
      topLine = ranges[0].startLineNumber;
    } else {
      const pos = sourceEditor.getPosition?.();
      topLine = pos?.lineNumber ?? 1;
    }

    const targetModel = targetEditor.getModel?.();
    const targetLineCount = targetModel?.getLineCount?.() ?? topLine;
    const safeLine = Math.min(Math.max(topLine, 1), targetLineCount);
    const targetTop = targetEditor.getTopForLineNumber?.(safeLine);
    if (typeof targetTop !== "number") return;

    isScrollingSyncRef.current = true;
    targetEditor.setScrollTop(targetTop);
    setTimeout(() => {
      isScrollingSyncRef.current = false;
    }, 50);
  }, []);

  const mountZh: OnMount = (editor) => {
    zhEditorRef.current = editor;
    editor.onDidFocusEditorText(() => {
      activePaneRef.current = "zh";
    });

    editor.onDidScrollChange(() => {
      alignByLine("zh");
    });
  };

  const mountEn: OnMount = (editor) => {
    enEditorRef.current = editor;
    editor.onDidFocusEditorText(() => {
      activePaneRef.current = "en";
    });

    editor.onDidScrollChange(() => {
      alignByLine("en");
    });
  };

  const insertAtActivePane = useCallback((text: string) => {
    const target = activePaneRef.current === "zh" ? zhEditorRef.current : enEditorRef.current;
    if (!target) return;
    const selection = target.getSelection();
    target.executeEdits("insert-image", [{ range: selection, text, forceMoveMarkers: true }]);
    target.focus();
  }, []);

  const handleImageSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setError("");
    const insertedKeys: string[] = [];

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file.type.startsWith("image/")) {
          continue;
        }

        const base64 = await fileToBase64(file);
        const imageKey = generateImageKey(file.name);

        setLocalImages((prev) => {
          const next = new Map(prev);
          next.set(imageKey, base64);
          return next;
        });

        insertedKeys.push(imageKey);
      }

      if (insertedKeys.length > 0) {
        const markdown = insertedKeys
          .map((key) => `![${key.split("-").pop() || "图片"}](${key})`)
          .join("\n\n");
        insertAtActivePane(markdown + "\n");
        setNotice(`成功导入 ${insertedKeys.length} 张本地图片`);
      }
    } catch (err) {
      setError(`图片导入失败：${err instanceof Error ? err.message : String(err)}`);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [insertAtActivePane]);

  function openPreviewPage() {
    const now = new Date().toISOString();
    savePreviewPayload({ zhText, enText, updatedAt: now, title: docTitle });
    toPage("preview");
  }

  async function runTranslate() {
    if (!zhText.trim()) {
      setError("请先输入中文内容再翻译。");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const llm = loadLlmSettings();
      const resp = await fetch(apiUrl("/api/translate"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: zhText,
          llm: {
            api_key: llm.apiKey,
            base_url: llm.baseUrl,
            model: llm.model,
            force_mock: llm.forceMock,
          },
        }),
      });
      if (!resp.ok) {
        const t = await resp.text();
        throw new Error(`请求失败(${resp.status}) ${t}`);
      }
      const data = (await resp.json()) as TranslateResponse;
      setEnText(data.translated ?? "");
      setNotice(data.mock ? "翻译完成（当前为 Mock 模式）。" : "翻译完成。");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onExportPdf() {
    if (!pdfCaptureRef.current) return;
    setError("");
    try {
      const exportWidth = pairCount > 48 ? 2100 : pairCount > 24 ? 1800 : 1500;
      pdfCaptureRef.current.style.width = `${exportWidth}px`;
      const safeName =
        (docTitle.trim() || "bilingual-dual-column").replace(/[\\/:*?"<>|]/g, "_");
      await exportDomToPdf(pdfCaptureRef.current, safeName, { rowCount: pairCount });
      pdfCaptureRef.current.style.width = "";
    } catch (e) {
      setError(`导出 PDF 失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div className="appShell">
      <header className="toolbar toolbar--rich">
        <div className="toolbar__title">
          <strong>双栏中英编辑器</strong>
          <span className="toolbar__hint">以中文段落为基准，对照英文段落段首对齐导出。</span>
        </div>
        <label className="toolbar__titleField">
          <span>文档标题</span>
          <input
            type="text"
            value={docTitle}
            onChange={(e) => setDocTitle(e.target.value)}
            placeholder={DEFAULT_DOC_TITLE}
            spellCheck={false}
          />
        </label>
        <div className="toolbar__stats">
          <span className="toolbar__badge">对照块 {pairCount}</span>
          <span className="toolbar__badge">本地图片 {localImages.size}</span>
          <span className="toolbar__badge">最近同步 {isoToLocal(lastSyncAt)}</span>
        </div>
        <div className="toolbar__actions">
          <button
            className={`btn ${scrollMode === "sync-line" ? "btn--sync-active" : "btn--sync"}`}
            onClick={() => setScrollMode((v) => v === "independent" ? "sync-line" : "independent")}
            type="button"
            title={
              scrollMode === "sync-line"
                ? "当前：行号同步滚动（点击切换为独立滚动）"
                : "当前：独立滚动（点击切换为行号同步滚动）"
            }
          >
            {scrollMode === "sync-line" ? "行号同步 ✓" : "独立滚动"}
          </button>
          <button className="btn btn--ghost" onClick={openPreviewPage} type="button">
            预览页
          </button>
          <button className="btn btn--ghost" onClick={() => toPage("settings")} type="button">
            API 配置页
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleImageSelect}
            style={{ display: "none" }}
          />
          <button
            className="btn btn--accent"
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            导入本地图片
          </button>
          <button className="btn btn--primary" disabled={busy} onClick={runTranslate} type="button">
            {busy ? "翻译中..." : "LLM 翻译填充"}
          </button>
          <button className="btn" onClick={onExportPdf} type="button">
            导出 PDF（双栏）
          </button>
        </div>
      </header>

      {error ? (
        <div className="banner">
          <div className="banner__text">{error}</div>
        </div>
      ) : null}
      {notice ? (
        <div className="banner banner--ok">
          <div className="banner__text">{notice}</div>
        </div>
      ) : null}

      <main className="grid2">
        <section className="pane">
          <div className="pane__head">中文（可编辑）</div>
          <div className="monacoWrap">
            <Editor
              value={zhText}
              onChange={(v) => setZhText(v ?? "")}
              onMount={mountZh}
              language="markdown"
              theme="vs"
              options={{ minimap: { enabled: false }, wordWrap: "on", fontSize: 14 }}
            />
          </div>
        </section>
        <section className="pane">
          <div className="pane__head">English（可编辑）</div>
          <div className="monacoWrap">
            <Editor
              value={enText}
              onChange={(v) => setEnText(v ?? "")}
              onMount={mountEn}
              language="markdown"
              theme="vs"
              options={{ minimap: { enabled: false }, wordWrap: "on", fontSize: 14 }}
            />
          </div>
        </section>
      </main>

      <div className="pdfCaptureHost" aria-hidden="true">
        <div className="pdfCaptureRoot" ref={pdfCaptureRef}>
          <h1 className="pdfTitle">{docTitle.trim() || DEFAULT_DOC_TITLE}</h1>
          <p className="pdfMeta">导出时间：{new Date().toLocaleString()}</p>
          <DualColumnPreview zhText={zhText} enText={enText} localImages={localImages} />
        </div>
      </div>
    </div>
  );
}

export function PreviewPage() {
  const [payload, setPayload] = useState(() => loadPreviewPayload());
  const [localImages, setLocalImages] = useState<Map<string, string>>(() => loadLocalImages());

  const previewTitle = (payload?.title?.trim() || DEFAULT_DOC_TITLE);

  useEffect(() => {
    document.title = previewTitle ? `${previewTitle} · 预览` : "双栏中英预览";
  }, [previewTitle]);

  useEffect(() => {
    const onStorage = (evt: StorageEvent) => {
      if (evt.key === PREVIEW_STORAGE_KEY) {
        setPayload(loadPreviewPayload());
      }
      if (evt.key === LOCAL_IMAGES_KEY) {
        setLocalImages(loadLocalImages());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const handleRefresh = useCallback(() => {
    setPayload(loadPreviewPayload());
    setLocalImages(loadLocalImages());
  }, []);

  if (!payload) {
    return (
      <div className="appShell">
        <div className="banner">
          <div className="banner__text">未检测到可预览内容，请先在主编辑窗口输入文本。</div>
        </div>
      </div>
    );
  }

  return (
    <div className="appShell appShell--preview">
      <header className="toolbar toolbar--rich">
        <div className="toolbar__title">
          <strong>{previewTitle}</strong>
          <span className="toolbar__hint">同站内独立页面预览，不使用浏览器弹窗。</span>
        </div>
        <div className="toolbar__stats">
          <span className="toolbar__badge">对照块 {buildRowPairs(payload.zhText, payload.enText).length}</span>
          <span className="toolbar__badge">本地图片 {localImages.size}</span>
          <span className="toolbar__badge">最近更新 {isoToLocal(payload.updatedAt)}</span>
        </div>
        <div className="toolbar__actions">
          <button className="btn btn--ghost" type="button" onClick={() => toPage("editor")}>
            返回编辑
          </button>
          <button className="btn btn--ghost" type="button" onClick={() => toPage("settings")}>
            API 配置页
          </button>
          <button className="btn" type="button" onClick={handleRefresh}>
            立即刷新
          </button>
        </div>
      </header>

      <section className="previewCard previewCard--full">
        <div className="pdfCaptureRoot">
          <h1 className="pdfTitle">{previewTitle}</h1>
          <p className="pdfMeta">更新时间：{isoToLocal(payload.updatedAt)}</p>
          <DualColumnPreview zhText={payload.zhText} enText={payload.enText} localImages={localImages} />
        </div>
      </section>
    </div>
  );
}

export function SettingsPage() {
  const [settings, setSettings] = useState<LlmConfig>(() => loadLlmSettings());
  const [savedAt, setSavedAt] = useState(new Date().toISOString());

  useEffect(() => {
    document.title = "LLM API 配置页";
  }, []);

  function saveNow() {
    saveLlmSettings(settings);
    setSavedAt(new Date().toISOString());
  }

  return (
    <div className="appShell appShell--settings">
      <header className="toolbar toolbar--rich">
        <div className="toolbar__title">
          <strong>LLM API 配置页</strong>
          <span className="toolbar__hint">独立页面维护 API Key / Base URL / Model，仅保存在本地浏览器。</span>
        </div>
        <div className="toolbar__stats">
          <span className="toolbar__badge">最近保存 {isoToLocal(savedAt)}</span>
        </div>
        <div className="toolbar__actions">
          <button className="btn btn--ghost" type="button" onClick={() => toPage("editor")}>
            返回编辑
          </button>
          <button className="btn btn--ghost" type="button" onClick={() => toPage("preview")}>
            预览页
          </button>
          <button className="btn btn--primary" type="button" onClick={saveNow}>
            保存配置
          </button>
        </div>
      </header>

      <section className="settingsCard">
        <label className="llmConfig__field">
          <span>API Key</span>
          <input
            type="password"
            value={settings.apiKey}
            onChange={(e) => setSettings((prev) => ({ ...prev, apiKey: e.target.value }))}
            placeholder="sk-..."
          />
        </label>

        <label className="llmConfig__field">
          <span>Base URL</span>
          <input
            type="text"
            value={settings.baseUrl}
            onChange={(e) => setSettings((prev) => ({ ...prev, baseUrl: e.target.value }))}
            placeholder="https://api.openai.com/v1"
          />
        </label>

        <label className="llmConfig__field">
          <span>Model</span>
          <input
            type="text"
            value={settings.model}
            onChange={(e) => setSettings((prev) => ({ ...prev, model: e.target.value }))}
            placeholder="gpt-4o-mini"
          />
        </label>

        <label className="llmConfig__check">
          <input
            type="checkbox"
            checked={settings.forceMock}
            onChange={(e) => setSettings((prev) => ({ ...prev, forceMock: e.target.checked }))}
          />
          <span>强制 Mock（仅用于调试）</span>
        </label>
      </section>
    </div>
  );
}
