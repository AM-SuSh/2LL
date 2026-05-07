export type LlmConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  forceMock: boolean;
};

export type PreviewPayload = {
  zhText: string;
  enText: string;
  updatedAt: string;
  title?: string;
};

export const PREVIEW_STORAGE_KEY = "bilingual-preview-payload-v1";
export const LLM_SETTINGS_KEY = "bilingual-llm-settings-v1";
export const DEFAULT_DOC_TITLE = "双栏中英一一对照";

export function savePreviewPayload(payload: PreviewPayload): void {
  localStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(payload));
}

export function loadPreviewPayload(): PreviewPayload | null {
  try {
    const raw = localStorage.getItem(PREVIEW_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PreviewPayload;
    if (typeof parsed.zhText !== "string" || typeof parsed.enText !== "string") return null;
    return {
      zhText: parsed.zhText,
      enText: parsed.enText,
      updatedAt: parsed.updatedAt,
      title: typeof parsed.title === "string" ? parsed.title : undefined,
    };
  } catch {
    return null;
  }
}

export function loadLlmSettings(): LlmConfig {
  try {
    const raw = localStorage.getItem(LLM_SETTINGS_KEY);
    if (!raw) {
      return {
        apiKey: "",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
        forceMock: false,
      };
    }
    const parsed = JSON.parse(raw) as Partial<LlmConfig>;
    return {
      apiKey: parsed.apiKey ?? "",
      baseUrl: parsed.baseUrl ?? "https://api.openai.com/v1",
      model: parsed.model ?? "gpt-4o-mini",
      forceMock: Boolean(parsed.forceMock),
    };
  } catch {
    return {
      apiKey: "",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      forceMock: false,
    };
  }
}

export function saveLlmSettings(settings: LlmConfig): void {
  localStorage.setItem(LLM_SETTINGS_KEY, JSON.stringify(settings));
}
