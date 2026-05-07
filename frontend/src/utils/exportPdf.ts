import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

/**
 * Rasterize DOM node into auto-sized landscape PDF.
 * Priority: keep CN/EN pair start-lines aligned in each row.
 */
type PdfOptions = {
  rowCount?: number;
};

function choosePreset(widthPx: number, rowCount: number): { format: "a4" | "a3"; orientation: "l" | "p" } {
  if (widthPx > 1700 || rowCount > 52) return { format: "a3", orientation: "l" };
  return { format: "a4", orientation: "l" };
}

export async function exportDomToPdf(
  root: HTMLElement,
  filenamePrefix = "bilingual-export",
  options: PdfOptions = {},
): Promise<void> {
  const preset = choosePreset(root.scrollWidth, options.rowCount ?? 0);
  const pdf = new jsPDF({ orientation: preset.orientation, unit: "mm", format: preset.format });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = preset.format === "a3" ? 14 : 10;
  const innerW = pageWidth - margin * 2;
  const innerH = pageHeight - margin * 2;

  const canvas = await html2canvas(root, {
    scale: Math.min(3, Math.max(2, window.devicePixelRatio || 2)),
    useCORS: true,
    backgroundColor: "#ffffff",
    logging: false,
    windowWidth: root.scrollWidth,
    windowHeight: root.scrollHeight,
  });

  const imgData = canvas.toDataURL("image/png");

  const imgH = (canvas.height * innerW) / canvas.width;

  let offset = 0;
  while (offset < imgH) {
    if (offset > 0) pdf.addPage();
    pdf.addImage(imgData, "PNG", margin, margin - offset, innerW, imgH);
    offset += innerH;
  }

  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  pdf.save(`${filenamePrefix}-${preset.format}-${preset.orientation}-${ts}.pdf`);
}
