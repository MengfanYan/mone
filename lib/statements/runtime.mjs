let resources;

// All assets come from this app, including the CJK font and PDF worker. The demo
// warms them before opening the workspace, so later actions work offline.
export function preparePdfRuntime() {
  if (!resources) {
    resources = Promise.all([
      import("./pdf.mjs"),
      import("pdfjs-dist/build/pdf.mjs"),
      fetch("/fonts/NotoSansSC.ttf").then((r) => {
        if (!r.ok) throw new Error("PDF font could not be loaded");
        return r.arrayBuffer();
      }),
    ])
      .then(async ([generator, renderer, fontBytes]) => {
        const worker = new renderer.PDFWorker({
          port: new globalThis.Worker("/pdf/pdf.worker.min.mjs", {
            type: "module",
          }),
        });
        await worker.promise;
        return { ...generator, renderer, fontBytes, worker };
      })
      .catch((error) => {
        resources = null;
        throw error;
      });
  }
  return resources;
}
