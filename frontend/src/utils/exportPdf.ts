import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

/**
 * Rasterize DOM node into a multi-page A4 PDF (vertical slice via negative offsets).
 */
export async function exportDomToPdf(
  root: HTMLElement,
  filenamePrefix = "bilingual-export",
): Promise<void> {
  const pdf = new jsPDF("p", "mm", "a4");
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 12;
  const innerW = pageWidth - margin * 2;
  const innerH = pageHeight - margin * 2;

  const canvas = await html2canvas(root, {
    scale: Math.min(2, window.devicePixelRatio || 2),
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
  pdf.save(`${filenamePrefix}-${ts}.pdf`);
}
