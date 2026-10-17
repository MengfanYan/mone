import { preparePdfRuntime } from "../statements/runtime.mjs";

// The original PDF stays in browser memory. Text PDFs retain all pages; one-page
// scanned PDFs render to a bounded local image for the existing reviewed OCR flow.
export async function prepareEvidencePdf(file) {
  if (file.size > 5 * 1024 * 1024) throw new Error("PDF_FILE_LIMIT");
  const { renderer, worker } = await preparePdfRuntime();
  const task = renderer.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    worker,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  let pdf;
  try {
    pdf = await task.promise;
    if (pdf.numPages > 5) throw new Error("PDF_PAGE_LIMIT");
    let text = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text +=
        content.items
          .map((item) => item.str + (item.hasEOL ? "\n" : " "))
          .join("") + "\n";
      if (text.length > 20000) throw new Error("PDF_TEXT_LIMIT");
    }
    const page = await pdf.getPage(1),
      natural = page.getViewport({ scale: 1 }),
      scale = Math.min(2, 1800 / Math.max(natural.width, natural.height)),
      viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport })
      .promise;
    const image = canvas.toDataURL("image/png");
    canvas.width = 0;
    canvas.height = 0;
    if (image.length > 6_990_000) throw new Error("PDF_IMAGE_LIMIT");
    if (!text.trim() && pdf.numPages !== 1) throw new Error("PDF_SCAN_PAGES");
    return {
      image,
      text: text.trim(),
      pdfText: !!text.trim(),
      pages: pdf.numPages,
    };
  } finally {
    if (pdf) await pdf.destroy();
    else await task.destroy();
  }
}
