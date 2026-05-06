type Props = {
  onTranslate: () => void;
  onExportMd: () => void;
  onExportPdf: () => void;
  busy: boolean;
  canTranslate: boolean;
  lastMock?: boolean | null;
};

export function Toolbar({
  onTranslate,
  onExportMd,
  onExportPdf,
  busy,
  canTranslate,
  lastMock,
}: Props) {
  return (
    <header className="toolbar">
      <div className="toolbar__title">
        <strong>双栏中英编辑器</strong>
        <span className="toolbar__hint">Markdown · 左中文 / 右英文</span>
      </div>
      <div className="toolbar__actions">
        <button
          type="button"
          className="btn btn--primary"
          onClick={onTranslate}
          disabled={busy || !canTranslate}
          title="将左侧中文翻译并写入右侧英文栏"
        >
          {busy ? "翻译中…" : "LLM 翻译填充"}
        </button>
        <button type="button" className="btn" onClick={onExportMd} disabled={busy}>
          导出 MD
        </button>
        <button type="button" className="btn" onClick={onExportPdf} disabled={busy}>
          导出 PDF
        </button>
      </div>
      {lastMock === true && (
        <div className="toolbar__badge" title="未配置 API Key 或启用了 mock 模式">
          Mock 翻译
        </div>
      )}
    </header>
  );
}
