import Editor, { OnMount } from "@monaco-editor/react";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { DualColumnPreview } from "./DualColumnPreview";
import { EditorMainToolbar, type ScrollMode } from "./EditorMainToolbar";
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

type TranslateResult =
  | { ok: true; translated: string; mock?: boolean }
  | { ok: false; error: string };

async function translateZhToEn(zhText: string): Promise<TranslateResult> {
  if (!zhText.trim()) {
    return { ok: false, error: "请先输入中文内容再翻译。" };
  }
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
      return { ok: false, error: `请求失败(${resp.status}) ${t}` };
    }
    const data = (await resp.json()) as TranslateResponse;
    return { ok: true, translated: data.translated ?? "", mock: data.mock };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
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
    setBusy(true);
    setError("");
    setNotice("");
    const r = await translateZhToEn(zhText);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setEnText(r.translated);
    setNotice(r.mock ? "翻译完成（当前为 Mock 模式）。" : "翻译完成。");
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
      <EditorMainToolbar
        docTitle={docTitle}
        onDocTitleChange={setDocTitle}
        pairCount={pairCount}
        localImagesCount={localImages.size}
        lastSyncDisplay={isoToLocal(lastSyncAt)}
        scrollMode={scrollMode}
        onToggleScrollMode={() =>
          setScrollMode((v) => (v === "independent" ? "sync-line" : "independent"))
        }
        onGoEditor={() => toPage("editor")}
        editorIsCurrentPage
        busyTranslate={busy}
        onTranslate={runTranslate}
        onGoPreview={openPreviewPage}
        previewIsCurrentPage={false}
        onGoSettings={() => toPage("settings")}
        settingsIsCurrentPage={false}
        showEditorActions
        fileInputRef={fileInputRef}
        onImageFileChange={handleImageSelect}
        onExportPdf={onExportPdf}
      />

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
  const [zhText, setZhText] = useState(() => loadPreviewPayload()?.zhText ?? "");
  const [enText, setEnText] = useState(() => loadPreviewPayload()?.enText ?? "");
  const [docTitle, setDocTitle] = useState(
    () =>
      loadPreviewPayload()?.title ??
      localStorage.getItem(TITLE_STORAGE_KEY) ??
      DEFAULT_DOC_TITLE,
  );
  const [lastSyncAt, setLastSyncAt] = useState(
    () => loadPreviewPayload()?.updatedAt ?? new Date().toISOString(),
  );
  const [localImages, setLocalImages] = useState<Map<string, string>>(() => loadLocalImages());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [scrollMode, setScrollMode] = useState<ScrollMode>(() => {
    const stored = localStorage.getItem(SCROLL_MODE_KEY);
    if (stored === "sync-line") return "sync-line";
    return "independent";
  });

  const pdfCaptureRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const pairCount = useMemo(() => buildRowPairs(zhText, enText).length, [zhText, enText]);

  useEffect(() => {
    const t = docTitle.trim();
    document.title = t ? `${t} · 预览` : "双栏中英预览";
  }, [docTitle]);

  useEffect(() => {
    if (!payload) return;
    localStorage.setItem(ZH_STORAGE_KEY, zhText);
    localStorage.setItem(EN_STORAGE_KEY, enText);
    localStorage.setItem(TITLE_STORAGE_KEY, docTitle);
    const now = new Date().toISOString();
    setLastSyncAt(now);
    savePreviewPayload({ zhText, enText, updatedAt: now, title: docTitle });
  }, [zhText, enText, docTitle, payload]);

  useEffect(() => {
    saveLocalImages(localImages);
  }, [localImages]);

  useEffect(() => {
    localStorage.setItem(SCROLL_MODE_KEY, scrollMode);
  }, [scrollMode]);

  useEffect(() => {
    const onStorage = (evt: StorageEvent) => {
      if (evt.key === PREVIEW_STORAGE_KEY) {
        const p = loadPreviewPayload();
        setPayload(p);
        if (p) {
          setZhText(p.zhText);
          setEnText(p.enText);
          setDocTitle(
            p.title ?? localStorage.getItem(TITLE_STORAGE_KEY) ?? DEFAULT_DOC_TITLE,
          );
          setLastSyncAt(p.updatedAt);
        }
      }
      if (evt.key === LOCAL_IMAGES_KEY) {
        setLocalImages(loadLocalImages());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const handleImageSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    setError("");
    const insertedKeys: string[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file.type.startsWith("image/")) continue;
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
        setZhText((z) => {
          const base = z.replace(/\s*$/, "");
          return base ? `${base}\n\n${markdown}\n` : `${markdown}\n`;
        });
        setNotice(`成功导入 ${insertedKeys.length} 张本地图片`);
      }
    } catch (err) {
      setError(`图片导入失败：${err instanceof Error ? err.message : String(err)}`);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const runTranslate = useCallback(async () => {
    setBusy(true);
    setError("");
    setNotice("");
    const r = await translateZhToEn(zhText);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setEnText(r.translated);
    setNotice(r.mock ? "翻译完成（当前为 Mock 模式）。" : "翻译完成。");
  }, [zhText]);

  const openPreviewPage = useCallback(() => {
    const now = new Date().toISOString();
    savePreviewPayload({ zhText, enText, updatedAt: now, title: docTitle });
    setLastSyncAt(now);
    toPage("preview");
  }, [zhText, enText, docTitle]);

  const onExportPdf = useCallback(async () => {
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
  }, [pairCount, docTitle]);

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
      <EditorMainToolbar
        docTitle={docTitle}
        onDocTitleChange={setDocTitle}
        pairCount={pairCount}
        localImagesCount={localImages.size}
        lastSyncDisplay={isoToLocal(lastSyncAt)}
        scrollMode={scrollMode}
        onToggleScrollMode={() =>
          setScrollMode((v) => (v === "independent" ? "sync-line" : "independent"))
        }
        onGoEditor={() => toPage("editor")}
        editorIsCurrentPage={false}
        busyTranslate={busy}
        onTranslate={runTranslate}
        onGoPreview={openPreviewPage}
        previewIsCurrentPage
        onGoSettings={() => toPage("settings")}
        settingsIsCurrentPage={false}
        showEditorActions={false}
        fileInputRef={fileInputRef}
        onImageFileChange={handleImageSelect}
        onExportPdf={onExportPdf}
      />
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

      <section className="previewCard previewCard--full">
        <div className="pdfCaptureRoot">
          <h1 className="pdfTitle">{docTitle.trim() || DEFAULT_DOC_TITLE}</h1>
          <p className="pdfMeta">更新时间：{isoToLocal(lastSyncAt)}</p>
          <DualColumnPreview zhText={zhText} enText={enText} localImages={localImages} />
        </div>
      </section>

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

export function SettingsPage() {
  const [settings, setSettings] = useState<LlmConfig>(() => loadLlmSettings());

  const [zhText, setZhText] = useState(() => loadPreviewPayload()?.zhText ?? "");
  const [enText, setEnText] = useState(() => loadPreviewPayload()?.enText ?? "");
  const [docTitle, setDocTitle] = useState(
    () =>
      loadPreviewPayload()?.title ??
      localStorage.getItem(TITLE_STORAGE_KEY) ??
      DEFAULT_DOC_TITLE,
  );
  const [lastSyncAt, setLastSyncAt] = useState(
    () => loadPreviewPayload()?.updatedAt ?? new Date().toISOString(),
  );
  const [localImages, setLocalImages] = useState<Map<string, string>>(() => loadLocalImages());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [scrollMode, setScrollMode] = useState<ScrollMode>(() => {
    const stored = localStorage.getItem(SCROLL_MODE_KEY);
    if (stored === "sync-line") return "sync-line";
    return "independent";
  });

  const pdfCaptureRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const pairCount = useMemo(() => buildRowPairs(zhText, enText).length, [zhText, enText]);

  useEffect(() => {
    document.title = "LLM API 配置页";
  }, []);

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

  useEffect(() => {
    const onStorage = (evt: StorageEvent) => {
      if (evt.key === PREVIEW_STORAGE_KEY) {
        const p = loadPreviewPayload();
        if (p) {
          setZhText(p.zhText);
          setEnText(p.enText);
          setDocTitle(
            p.title ?? localStorage.getItem(TITLE_STORAGE_KEY) ?? DEFAULT_DOC_TITLE,
          );
          setLastSyncAt(p.updatedAt);
        }
      }
      if (evt.key === LOCAL_IMAGES_KEY) {
        setLocalImages(loadLocalImages());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  function saveApiSettings() {
    saveLlmSettings(settings);
    setNotice("API 配置已保存。");
  }

  const handleImageSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    setError("");
    const insertedKeys: string[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file.type.startsWith("image/")) continue;
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
        setZhText((z) => {
          const base = z.replace(/\s*$/, "");
          return base ? `${base}\n\n${markdown}\n` : `${markdown}\n`;
        });
        setNotice(`成功导入 ${insertedKeys.length} 张本地图片`);
      }
    } catch (err) {
      setError(`图片导入失败：${err instanceof Error ? err.message : String(err)}`);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const runTranslate = useCallback(async () => {
    setBusy(true);
    setError("");
    setNotice("");
    const r = await translateZhToEn(zhText);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setEnText(r.translated);
    setNotice(r.mock ? "翻译完成（当前为 Mock 模式）。" : "翻译完成。");
  }, [zhText]);

  const openPreviewPage = useCallback(() => {
    const now = new Date().toISOString();
    savePreviewPayload({ zhText, enText, updatedAt: now, title: docTitle });
    toPage("preview");
  }, [zhText, enText, docTitle]);

  const onExportPdf = useCallback(async () => {
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
  }, [pairCount, docTitle]);

  return (
    <div className="appShell appShell--settings">
      <EditorMainToolbar
        docTitle={docTitle}
        onDocTitleChange={setDocTitle}
        pairCount={pairCount}
        localImagesCount={localImages.size}
        lastSyncDisplay={isoToLocal(lastSyncAt)}
        scrollMode={scrollMode}
        onToggleScrollMode={() =>
          setScrollMode((v) => (v === "independent" ? "sync-line" : "independent"))
        }
        onGoEditor={() => toPage("editor")}
        editorIsCurrentPage={false}
        busyTranslate={busy}
        onTranslate={runTranslate}
        onGoPreview={openPreviewPage}
        previewIsCurrentPage={false}
        onGoSettings={() => toPage("settings")}
        settingsIsCurrentPage
        showEditorActions={false}
        fileInputRef={fileInputRef}
        onImageFileChange={handleImageSelect}
        onExportPdf={onExportPdf}
      />

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

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            paddingTop: 8,
            borderTop: "1px solid var(--border-light)",
          }}
        >
          <button className="btn btn--primary" type="button" onClick={saveApiSettings}>
            保存 API 配置
          </button>
        </div>
      </section>

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
