import type { ScrollMode } from "../components/EditorMainToolbar";
import {
  DEFAULT_DOC_TITLE,
  savePreviewPayload,
  type PreviewPayload,
} from "./previewBridge";

export const DRAFT_FILE_EXTENSION = ".2ll-draft.json";

export type DraftDocument = {
  format: "bilingual-editor-draft";
  version: 1;
  updatedAt: string;
  title: string;
  zhText: string;
  enText: string;
  scrollMode: ScrollMode;
  /** local://... -> data URL */
  localImages: Record<string, string>;
};

const DB_NAME = "bilingual-editor-autosave-v1";
const STORE_NAME = "drafts";
const DRAFT_KEY = "current";
const LINKED_FILE_HANDLE_KEY = "linked-draft-file-handle";

function isScrollMode(v: unknown): v is ScrollMode {
  return v === "independent" || v === "sync-line";
}

export function buildDraftDocument(params: {
  title: string;
  zhText: string;
  enText: string;
  scrollMode: ScrollMode;
  localImages: Map<string, string>;
  updatedAt?: string;
}): DraftDocument {
  const images: Record<string, string> = {};
  params.localImages.forEach((dataUrl, key) => {
    images[key] = dataUrl;
  });
  return {
    format: "bilingual-editor-draft",
    version: 1,
    updatedAt: params.updatedAt ?? new Date().toISOString(),
    title: params.title,
    zhText: params.zhText,
    enText: params.enText,
    scrollMode: params.scrollMode,
    localImages: images,
  };
}

export function parseDraftJson(raw: string): DraftDocument | null {
  try {
    const o = JSON.parse(raw) as Partial<DraftDocument>;
    if (o.format !== "bilingual-editor-draft" || o.version !== 1) return null;
    if (typeof o.updatedAt !== "string" || typeof o.zhText !== "string" || typeof o.enText !== "string") {
      return null;
    }
    if (typeof o.title !== "string") return null;
    if (!isScrollMode(o.scrollMode)) return null;
    const li = o.localImages;
    if (li !== undefined && (typeof li !== "object" || li === null || Array.isArray(li))) return null;
    const localImages: Record<string, string> = {};
    if (li && typeof li === "object") {
      for (const [k, v] of Object.entries(li)) {
        if (typeof v === "string") localImages[k] = v;
      }
    }
    return {
      format: "bilingual-editor-draft",
      version: 1,
      updatedAt: o.updatedAt,
      title: o.title,
      zhText: o.zhText,
      enText: o.enText,
      scrollMode: o.scrollMode,
      localImages,
    };
  } catch {
    return null;
  }
}

export function stringifyDraft(d: DraftDocument): string {
  return JSON.stringify(d, null, 2);
}

export function draftToPreviewPayload(d: DraftDocument): PreviewPayload {
  return {
    zhText: d.zhText,
    enText: d.enText,
    updatedAt: d.updatedAt,
    title: d.title,
  };
}

export function isDraftEffectivelyEmpty(d: DraftDocument): boolean {
  if (d.zhText.trim() || d.enText.trim()) return false;
  if (Object.keys(d.localImages).length > 0) return false;
  const t = d.title.trim();
  if (t && t !== DEFAULT_DOC_TITLE) return false;
  return true;
}

/** 将草稿写回 localStorage 预览桥与分栏键（与 BilingualEditor 一致） */
export function persistDraftToLocalStorage(
  d: DraftDocument,
  keys: { zh: string; en: string; title: string; scroll: string; images: string },
): void {
  try {
    localStorage.setItem(keys.zh, d.zhText);
    localStorage.setItem(keys.en, d.enText);
    localStorage.setItem(keys.title, d.title);
    localStorage.setItem(keys.scroll, d.scrollMode);
    savePreviewPayload(draftToPreviewPayload(d));
  } catch {
    /* QuotaExceeded：仍可由 IndexedDB 承载 */
  }
  try {
    localStorage.setItem(keys.images, JSON.stringify(d.localImages));
  } catch {
    /* 大图集可能超出配额，忽略 */
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onerror = () => reject(req.error ?? new Error("indexedDB.open failed"));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

export async function idbSaveDraft(draft: DraftDocument): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("idb transaction failed"));
    tx.objectStore(STORE_NAME).put(draft, DRAFT_KEY);
  });
}

export function isFileSystemAccessAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.showSaveFilePicker === "function" &&
    typeof window.showOpenFilePicker === "function"
  );
}

export async function idbSaveLinkedDraftHandle(handle: FileSystemFileHandle | null): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("idb handle write failed"));
    const store = tx.objectStore(STORE_NAME);
    if (handle === null) {
      store.delete(LINKED_FILE_HANDLE_KEY);
    } else {
      store.put(handle, LINKED_FILE_HANDLE_KEY);
    }
  });
}

export async function idbLoadLinkedDraftHandle(): Promise<FileSystemFileHandle | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      tx.onerror = () => reject(tx.error ?? new Error("idb handle read failed"));
      const req = tx.objectStore(STORE_NAME).get(LINKED_FILE_HANDLE_KEY);
      req.onerror = () => reject(req.error ?? new Error("idb handle get failed"));
      req.onsuccess = () => {
        const v = req.result;
        resolve(v instanceof FileSystemFileHandle ? v : null);
      };
    });
  } catch {
    return null;
  }
}

/**
 * 注意：showSaveFilePicker / showOpenFilePicker 的 accept 条目必须是「单一」扩展名
 *（如 .json）。`.2ll-draft.json` 这类含多段点的字符串会被 Chromium 判为非法。
 * 实际保存仍可用 suggestedName 生成 `标题.2ll-draft.json`；打开时选任意 .json 即可。
 */
const DRAFT_ACCEPT: FilePickerAcceptType[] = [
  {
    description: "2LL 双语草稿（JSON）",
    accept: {
      "application/json": [".json"],
    },
  },
];

export async function ensureWritePermission(handle: FileSystemFileHandle): Promise<boolean> {
  const opts = { mode: "readwrite" as const };
  let perm = await handle.queryPermission(opts);
  if (perm === "granted") return true;
  if (perm === "denied") return false;
  perm = await handle.requestPermission(opts);
  return perm === "granted";
}

export async function writeDraftToFileHandle(
  handle: FileSystemFileHandle,
  draft: DraftDocument,
): Promise<void> {
  if (!(await ensureWritePermission(handle))) {
    throw new Error("无法写入文件：未获得写入权限。");
  }
  const writable = await handle.createWritable();
  try {
    await writable.write(new Blob([stringifyDraft(draft)], { type: "application/json;charset=utf-8" }));
    await writable.close();
  } catch (e) {
    try {
      await writable.close();
    } catch {
      /* ignore */
    }
    throw e;
  }
}

/** 弹出「另存为」并返回所选文件句柄（用户取消则 null） */
export async function pickSaveDraftFile(
  suggestedBaseName: string,
): Promise<FileSystemFileHandle | null> {
  if (!isFileSystemAccessAvailable()) return null;
  const safe = (suggestedBaseName.trim() || "draft").replace(/[\\/:*?"<>|]/g, "_");
  const defaultName = safe.endsWith(".json") ? safe : `${safe}${DRAFT_FILE_EXTENSION}`;
  try {
    return await window.showSaveFilePicker({
      suggestedName: defaultName,
      types: DRAFT_ACCEPT,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return null;
    throw e;
  }
}

/** 弹出「打开」并返回文件句柄（用户取消则 null） */
export async function pickOpenDraftFile(): Promise<FileSystemFileHandle | null> {
  if (!isFileSystemAccessAvailable()) return null;
  try {
    const handles = await window.showOpenFilePicker({
      multiple: false,
      types: DRAFT_ACCEPT,
    });
    return handles[0] ?? null;
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return null;
    throw e;
  }
}

export async function idbLoadDraft(): Promise<DraftDocument | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      tx.onerror = () => reject(tx.error ?? new Error("idb read failed"));
      const req = tx.objectStore(STORE_NAME).get(DRAFT_KEY);
      req.onerror = () => reject(req.error ?? new Error("idb get failed"));
      req.onsuccess = () => {
        const v = req.result;
        if (v == null || typeof v !== "object") {
          resolve(null);
          return;
        }
        resolve(parseDraftJson(JSON.stringify(v)));
      };
    });
  } catch {
    return null;
  }
}

export function downloadDraftFile(draft: DraftDocument, suggestedBaseName: string): void {
  const safe = (suggestedBaseName.trim() || "draft").replace(/[\\/:*?"<>|]/g, "_");
  const name = safe.endsWith(".json") ? safe : `${safe}${DRAFT_FILE_EXTENSION}`;
  const blob = new Blob([stringifyDraft(draft)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsText(file, "utf-8");
  });
}

export function previewPayloadToDraftShape(p: PreviewPayload, scrollMode: ScrollMode, images: Map<string, string>): DraftDocument {
  return buildDraftDocument({
    title: p.title ?? "",
    zhText: p.zhText,
    enText: p.enText,
    scrollMode,
    localImages: images,
    updatedAt: p.updatedAt,
  });
}
