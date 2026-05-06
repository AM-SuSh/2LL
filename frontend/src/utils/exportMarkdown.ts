function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Export bilingual Markdown: clear sections for CN / EN.
 */
export function exportBilingualMarkdown(zhText: string, enText: string): void {
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const body = `# 双语文档（中英）

导出时间（UTC）：\`${new Date().toISOString()}\`

---

## 中文

${zhText.trimEnd()}

---

## English

${enText.trimEnd()}

---
`;
  downloadText(`bilingual-${ts}.md`, body);
}
