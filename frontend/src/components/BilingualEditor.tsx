import Editor, { OnMount } from "@monaco-editor/react";
import { useEffect, useMemo, useRef, useState, useCallback, type ChangeEvent } from "react";
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
import {
  buildDraftDocument,
  type DraftDocument,
  downloadDraftFile,
  draftToPreviewPayload,
  idbLoadDraft,
  idbLoadLinkedDraftHandle,
  idbSaveDraft,
  idbSaveLinkedDraftHandle,
  isDraftEffectivelyEmpty,
  isFileSystemAccessAvailable,
  parseDraftJson,
  persistDraftToLocalStorage,
  pickOpenDraftFile,
  pickSaveDraftFile,
  previewPayloadToDraftShape,
  readFileAsText,
  writeDraftToFileHandle,
} from "../utils/draftStorage";

type TranslateResponse = {
  translated: string;
  mock?: boolean;
};

const ZH_STORAGE_KEY = "bilingual-editor-zh-v1";
const EN_STORAGE_KEY = "bilingual-editor-en-v1";
const TITLE_STORAGE_KEY = "bilingual-editor-title-v1";
const LOCAL_IMAGES_KEY = "bilingual-editor-images-v1";
const SCROLL_MODE_KEY = "bilingual-editor-scroll-mode-v1";

const LS_DRAFT_KEYS = {
  zh: ZH_STORAGE_KEY,
  en: EN_STORAGE_KEY,
  title: TITLE_STORAGE_KEY,
  scroll: SCROLL_MODE_KEY,
  images: LOCAL_IMAGES_KEY,
} as const;

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
  /** 外部替换全文（草稿/IDB）时递增，强制 Monaco 重挂载，避免受控 value 整篇 replace 导致光标跑尾部 */
  const [docSessionKey, setDocSessionKey] = useState(0);

  const zhEditorRef = useRef<any>(null);
  const enEditorRef = useRef<any>(null);
  const activePaneRef = useRef<"zh" | "en">("zh");
  const pdfCaptureRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const draftFileInputRef = useRef<HTMLInputElement | null>(null);
  const linkedLocalDraftHandleRef = useRef<FileSystemFileHandle | null>(null);
  const [linkedLocalDraftName, setLinkedLocalDraftName] = useState<string | null>(null);
  const isScrollingSyncRef = useRef(false);

  const pairCount = useMemo(() => buildRowPairs(zhText, enText).length, [zhText, enText]);

  useEffect(() => {
    void idbLoadLinkedDraftHandle().then((h) => {
      linkedLocalDraftHandleRef.current = h;
      setLinkedLocalDraftName(h?.name ?? null);
    });
  }, []);

  /** 启动时若 IndexedDB 自动保存比 localStorage 更新，则恢复（容量更大、可应对配额问题） */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const idbDraft = await idbLoadDraft();
      if (cancelled || !idbDraft || isDraftEffectivelyEmpty(idbDraft)) return;

      const preview = loadPreviewPayload();
      const scrollStored = localStorage.getItem(SCROLL_MODE_KEY);
      const scroll: ScrollMode = scrollStored === "sync-line" ? "sync-line" : "independent";
      const imagesMap = loadLocalImages();
      const fromLs = preview
        ? previewPayloadToDraftShape(preview, scroll, imagesMap)
        : buildDraftDocument({
            title: localStorage.getItem(TITLE_STORAGE_KEY) ?? "",
            zhText: localStorage.getItem(ZH_STORAGE_KEY) ?? "",
            enText: localStorage.getItem(EN_STORAGE_KEY) ?? "",
            scrollMode: scroll,
            localImages: imagesMap,
            updatedAt: new Date(0).toISOString(),
          });

      const tIdb = Date.parse(idbDraft.updatedAt);
      const tLs = Date.parse(fromLs.updatedAt);
      const idbIsNewer =
        !Number.isFinite(tLs) || (Number.isFinite(tIdb) && tIdb >= tLs);

      if (!idbIsNewer) return;

      setZhText(idbDraft.zhText);
      setEnText(idbDraft.enText);
      setDocTitle(idbDraft.title.trim() ? idbDraft.title : DEFAULT_DOC_TITLE);
      setScrollMode(idbDraft.scrollMode);
      setLocalImages(new Map(Object.entries(idbDraft.localImages)));
      setLastSyncAt(idbDraft.updatedAt);
      persistDraftToLocalStorage(idbDraft, LS_DRAFT_KEYS);
      setDocSessionKey((k) => k + 1);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const draft = buildDraftDocument({
      title: docTitle,
      zhText,
      enText,
      scrollMode,
      localImages,
    });
    const t = window.setTimeout(() => {
      void idbSaveDraft(draft);
    }, 600);
    return () => window.clearTimeout(t);
  }, [zhText, enText, docTitle, scrollMode, localImages]);

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

  const applyDraftFromDocument = useCallback(async (d: DraftDocument, linkHandle: FileSystemFileHandle | null) => {
    const now = new Date().toISOString();
    const merged: DraftDocument = { ...d, updatedAt: now };
    setZhText(merged.zhText);
    setEnText(merged.enText);
    setDocTitle(merged.title.trim() ? merged.title : DEFAULT_DOC_TITLE);
    setScrollMode(merged.scrollMode);
    setLocalImages(new Map(Object.entries(merged.localImages)));
    setLastSyncAt(now);
    setDocSessionKey((k) => k + 1);
    persistDraftToLocalStorage(merged, LS_DRAFT_KEYS);
    await idbSaveDraft(merged);
    linkedLocalDraftHandleRef.current = linkHandle;
    setLinkedLocalDraftName(linkHandle?.name ?? null);
    await idbSaveLinkedDraftHandle(linkHandle);
  }, []);

  const handleClearLinkedLocalDraft = useCallback(() => {
    setError("");
    setNotice("");
    linkedLocalDraftHandleRef.current = null;
    setLinkedLocalDraftName(null);
    void idbSaveLinkedDraftHandle(null);
    setNotice("已解除与本地文件的关联。编辑内容仍在浏览器内自动保存；仍可「另存为」导出到本机。");
  }, []);

  const handleSaveDraft = useCallback(async () => {
    setError("");
    setNotice("");
    const now = new Date().toISOString();
    const d = buildDraftDocument({
      title: docTitle,
      zhText,
      enText,
      scrollMode,
      localImages,
      updatedAt: now,
    });
    try {
      const linked = linkedLocalDraftHandleRef.current;
      if (linked) {
        await writeDraftToFileHandle(linked, d);
        setLastSyncAt(d.updatedAt);
        persistDraftToLocalStorage(d, LS_DRAFT_KEYS);
        savePreviewPayload(draftToPreviewPayload(d));
        await idbSaveDraft(d);
        setNotice(`已写入本地文件「${linked.name}」。`);
        return;
      }
      if (isFileSystemAccessAvailable()) {
        const picked = await pickSaveDraftFile(docTitle.trim() || "draft");
        if (!picked) {
          setNotice("已取消保存。");
          return;
        }
        await writeDraftToFileHandle(picked, d);
        linkedLocalDraftHandleRef.current = picked;
        setLinkedLocalDraftName(picked.name);
        await idbSaveLinkedDraftHandle(picked);
        setLastSyncAt(d.updatedAt);
        persistDraftToLocalStorage(d, LS_DRAFT_KEYS);
        savePreviewPayload(draftToPreviewPayload(d));
        await idbSaveDraft(d);
        setNotice(`已保存到「${picked.name}」。之后点「保存草稿」将直接覆盖此文件。`);
        return;
      }
      downloadDraftFile(d, docTitle.trim() || "draft");
      setNotice(
        "已触发下载草稿。若使用 Chrome / Edge，可直接保存到固定路径并支持下次覆盖写入；当前浏览器将以下载方式导出。",
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`保存草稿失败：${msg}`);
      linkedLocalDraftHandleRef.current = null;
      setLinkedLocalDraftName(null);
      await idbSaveLinkedDraftHandle(null);
    }
  }, [docTitle, zhText, enText, scrollMode, localImages]);

  const handleSaveDraftAs = useCallback(async () => {
    setError("");
    setNotice("");
    const now = new Date().toISOString();
    const d = buildDraftDocument({
      title: docTitle,
      zhText,
      enText,
      scrollMode,
      localImages,
      updatedAt: now,
    });
    try {
      if (!isFileSystemAccessAvailable()) {
        downloadDraftFile(d, docTitle.trim() || "draft");
        setNotice("当前浏览器以下载方式另存草稿。");
        return;
      }
      const picked = await pickSaveDraftFile(docTitle.trim() || "draft");
      if (!picked) {
        setNotice("已取消另存为。");
        return;
      }
      await writeDraftToFileHandle(picked, d);
      linkedLocalDraftHandleRef.current = picked;
      setLinkedLocalDraftName(picked.name);
      await idbSaveLinkedDraftHandle(picked);
      setLastSyncAt(d.updatedAt);
      persistDraftToLocalStorage(d, LS_DRAFT_KEYS);
      savePreviewPayload(draftToPreviewPayload(d));
      await idbSaveDraft(d);
      setNotice(`已另存为「${picked.name}」，后续「保存草稿」将写入此文件。`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`另存为失败：${msg}`);
      linkedLocalDraftHandleRef.current = null;
      setLinkedLocalDraftName(null);
      await idbSaveLinkedDraftHandle(null);
    }
  }, [docTitle, zhText, enText, scrollMode, localImages]);

  const handleOpenDraftPick = useCallback(async () => {
    setError("");
    setNotice("");
    if (isFileSystemAccessAvailable()) {
      try {
        const h = await pickOpenDraftFile();
        if (!h) {
          setNotice("已取消打开。");
          return;
        }
        const file = await h.getFile();
        const raw = await readFileAsText(file);
        const d = parseDraftJson(raw);
        if (!d) {
          setError("无法识别草稿文件，请使用本应用保存的 .2ll-draft.json / JSON。");
          return;
        }
        await applyDraftFromDocument(d, h);
        setNotice(`已打开「${h.name}」，可继续编辑；保存时将写回此文件（若权限允许）。`);
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(`打开草稿失败：${msg}`);
        return;
      }
    }
    draftFileInputRef.current?.click();
  }, [applyDraftFromDocument]);

  const handleDraftFileChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setError("");
      setNotice("");
      try {
        const raw = await readFileAsText(file);
        const d = parseDraftJson(raw);
        if (!d) {
          setError("无法识别草稿文件，请使用本应用「保存草稿」生成的 JSON。");
          return;
        }
        await applyDraftFromDocument(d, null);
        setNotice("已从草稿文件恢复。当前浏览器未提供可写文件句柄，请用「另存为」导出到新文件以固定路径。");
      } catch (err) {
        setError(`导入草稿失败：${err instanceof Error ? err.message : String(err)}`);
      }
      if (draftFileInputRef.current) draftFileInputRef.current.value = "";
    },
    [applyDraftFromDocument],
  );

  function openPreviewPage() {
    const now = new Date().toISOString();
    savePreviewPayload({ zhText, enText, updatedAt: now, title: docTitle });
    toPage("preview");
  }

  async function runTranslate() {
    setBusy(true);
    setError("");
    setNotice("");
    const zhSource =
      typeof zhEditorRef.current?.getValue === "function"
        ? (zhEditorRef.current.getValue() as string)
        : zhText;
    const r = await translateZhToEn(zhSource);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setEnText(r.translated);
    enEditorRef.current?.setValue?.(r.translated);
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
        linkedLocalDraftName={linkedLocalDraftName}
        onClearLinkedDraft={linkedLocalDraftName ? handleClearLinkedLocalDraft : undefined}
        onSaveDraft={() => void handleSaveDraft()}
        onSaveDraftAs={() => void handleSaveDraftAs()}
        onOpenDraft={() => void handleOpenDraftPick()}
        draftFileInputRef={draftFileInputRef}
        onDraftFileChange={handleDraftFileChange}
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
              key={`zh-${docSessionKey}`}
              defaultValue={zhText}
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
              key={`en-${docSessionKey}`}
              defaultValue={enText}
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
    if (payload) return;
    let cancelled = false;
    void idbLoadDraft().then((d) => {
      if (cancelled || !d || isDraftEffectivelyEmpty(d)) return;
      persistDraftToLocalStorage(d, LS_DRAFT_KEYS);
      setPayload(draftToPreviewPayload(d));
      setZhText(d.zhText);
      setEnText(d.enText);
      setDocTitle(d.title.trim() ? d.title : DEFAULT_DOC_TITLE);
      setLastSyncAt(d.updatedAt);
      setLocalImages(new Map(Object.entries(d.localImages)));
      setScrollMode(d.scrollMode);
    });
    return () => {
      cancelled = true;
    };
  }, [payload]);

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
          <div className="banner__text">
            未在浏览器缓存中检测到预览数据。若曾在此设备上编辑，正在尝试从 IndexedDB
            自动保存恢复；若仍无法显示，请返回编辑页或导入之前导出的草稿 JSON。
          </div>
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
