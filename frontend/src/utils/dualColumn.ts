export type RowPair = {
  zh: string;
  en: string;
  type?: "heading" | "paragraph" | "list" | "code" | "other";
};

export function splitMarkdownBlocks(text: string): string[] {
  const cleaned = text.trim();
  if (!cleaned) return [];

  const blocks: string[] = [];
  const lines = cleaned.split("\n");
  let currentBlock: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    if (trimmedLine.startsWith("#")) {
      if (currentBlock.length > 0) {
        blocks.push(currentBlock.join("\n").trim());
        currentBlock = [];
      }
      blocks.push(trimmedLine);
    } else if (trimmedLine === "") {
      if (currentBlock.length > 0) {
        blocks.push(currentBlock.join("\n").trim());
        currentBlock = [];
      }
    } else {
      currentBlock.push(line);
    }
  }

  if (currentBlock.length > 0) {
    blocks.push(currentBlock.join("\n").trim());
  }

  return blocks.filter(Boolean);
}

export function detectBlockType(block: string): RowPair["type"] {
  const trimmed = block.trim();
  if (trimmed.startsWith("#")) return "heading";
  if (trimmed.startsWith("```")) return "code";
  if (/^[-*+]\s|^\d+\.\s/.test(trimmed)) return "list";
  return "paragraph";
}

export function buildRowPairs(zhText: string, enText: string): RowPair[] {
  const zhBlocks = splitMarkdownBlocks(zhText);
  const enBlocks = splitMarkdownBlocks(enText);
  const size = Math.max(zhBlocks.length, enBlocks.length);
  const rows: RowPair[] = [];
  for (let i = 0; i < size; i += 1) {
    const zh = zhBlocks[i] ?? "";
    rows.push({
      zh,
      en: enBlocks[i] ?? "",
      type: detectBlockType(zh),
    });
  }
  return rows;
}
