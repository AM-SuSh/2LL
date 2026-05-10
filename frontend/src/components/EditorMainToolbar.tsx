import type { ChangeEvent, RefObject } from "react";
import { DEFAULT_DOC_TITLE } from "../utils/previewBridge";

export type ScrollMode = "independent" | "sync-line";

export type EditorMainToolbarProps = {
  docTitle: string;
  onDocTitleChange: (value: string) => void;
  pairCount: number;
  localImagesCount: number;
  lastSyncDisplay: string;
  scrollMode: ScrollMode;
  onToggleScrollMode: () => void;
  onGoEditor: () => void;
  editorIsCurrentPage: boolean;
  busyTranslate: boolean;
  onTranslate: () => void;
  onGoPreview: () => void;
  previewIsCurrentPage: boolean;
  onGoSettings: () => void;
  settingsIsCurrentPage: boolean;
  showEditorActions: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onImageFileChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onExportPdf: () => void;
  /** 未传则不显示草稿保存/打开（隐藏 file 仍由页面挂载用于旧浏览器） */
  linkedLocalDraftName?: string | null;
  onClearLinkedDraft?: () => void;
  onSaveDraft?: () => void;
  onSaveDraftAs?: () => void;
  onOpenDraft?: () => void;
  draftFileInputRef?: RefObject<HTMLInputElement | null>;
  onDraftFileChange?: (e: ChangeEvent<HTMLInputElement>) => void;
};

/** 与编辑页完全相同的顶栏结构与按钮排布（各页仅通过 props 区分行为 / 禁用态） */
export function EditorMainToolbar(props: EditorMainToolbarProps) {
  const {
    docTitle,
    onDocTitleChange,
    pairCount,
    localImagesCount,
    lastSyncDisplay,
    scrollMode,
    onToggleScrollMode,
    onGoEditor,
    editorIsCurrentPage,
    busyTranslate,
    onTranslate,
    onGoPreview,
    previewIsCurrentPage,
    onGoSettings,
    settingsIsCurrentPage,
    showEditorActions,
    fileInputRef,
    onImageFileChange,
    onExportPdf,
    linkedLocalDraftName,
    onClearLinkedDraft,
    onSaveDraft,
    onSaveDraftAs,
    onOpenDraft,
    draftFileInputRef,
    onDraftFileChange,
  } = props;

  return (
    <header className="toolbar toolbar--rich">
      <div className="toolbar__inner">
        <div className="toolbar__title">
          <strong>双栏中英编辑器</strong>
          <span className="toolbar__hint">以中文段落为基准，对照英文段落段首对齐导出。</span>
        </div>
        <label className="toolbar__titleField">
          <span>文档标题</span>
          <input
            type="text"
            value={docTitle}
            onChange={(e) => onDocTitleChange(e.target.value)}
            placeholder={DEFAULT_DOC_TITLE}
            spellCheck={false}
          />
        </label>
        <div className="toolbar__stats">
          <span className="toolbar__badge">对照块 {pairCount}</span>
          <span className="toolbar__badge">本地图片 {localImagesCount}</span>
          <span className="toolbar__badge">最近同步 {lastSyncDisplay}</span>
          {linkedLocalDraftName ? (
            <span className="toolbar__badge toolbar__badge--file" title="后续点「保存草稿」将覆盖此路径（Chrome / Edge）">
              本地文件 {linkedLocalDraftName}
            </span>
          ) : null}
        </div>
        <div className="toolbar__actions">
          {showEditorActions ? (
            <div className="toolbar__editorActions">
              <button
                className={`btn ${scrollMode === "sync-line" ? "btn--sync-active" : "btn--sync"}`}
                onClick={onToggleScrollMode}
                type="button"
                title={
                  scrollMode === "sync-line"
                    ? "当前：行号同步滚动（点击切换为独立滚动）"
                    : "当前：独立滚动（点击切换为行号同步滚动）"
                }
              >
                {scrollMode === "sync-line" ? "行号同步 ✓" : "独立滚动"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={onImageFileChange}
                style={{ display: "none" }}
              />
              <button
                className="btn btn--accent"
                onClick={() => fileInputRef.current?.click()}
                type="button"
              >
                导入本地图片
              </button>
              <button
                className="btn btn--primary"
                disabled={busyTranslate}
                onClick={onTranslate}
                type="button"
              >
                {busyTranslate ? "翻译中..." : "LLM 翻译填充"}
              </button>
              <button className="btn" onClick={onExportPdf} type="button">
                导出 PDF（双栏）
              </button>
              {onSaveDraft && onSaveDraftAs && onOpenDraft && draftFileInputRef && onDraftFileChange ? (
                <>
                  <input
                    ref={draftFileInputRef}
                    type="file"
                    accept="application/json,.json,.2ll-draft.json"
                    onChange={onDraftFileChange}
                    style={{ display: "none" }}
                  />
                  <button
                    className="btn btn--primary"
                    onClick={onSaveDraft}
                    type="button"
                    title="已关联本地文件时直接覆盖；否则弹出保存位置（不支持时改为下载）"
                  >
                    保存草稿
                  </button>
                  <button
                    className="btn"
                    onClick={onSaveDraftAs}
                    type="button"
                    title="始终选择新的保存位置"
                  >
                    另存为…
                  </button>
                  <button
                    className="btn"
                    onClick={onOpenDraft}
                    type="button"
                    title="从本机 JSON 草稿继续编辑（Chrome / Edge 可直接写回同一文件）"
                  >
                    打开草稿
                  </button>
                  {linkedLocalDraftName && onClearLinkedDraft ? (
                    <button
                      className="btn btn--ghost"
                      onClick={onClearLinkedDraft}
                      type="button"
                      title="不再覆盖上次选择的本地文件（内容仍在浏览器自动保存中）"
                    >
                      解除关联
                    </button>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}

          <div className="toolbar__nav">
            <button
              className="btn btn--ghost"
              onClick={onGoEditor}
              type="button"
              disabled={editorIsCurrentPage}
            >
              编辑页
            </button>
            <button
              className="btn btn--ghost"
              onClick={onGoPreview}
              type="button"
              disabled={previewIsCurrentPage}
            >
              预览页
            </button>
            <button
              className="btn btn--ghost"
              onClick={onGoSettings}
              type="button"
              disabled={settingsIsCurrentPage}
            >
              API 配置页
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
