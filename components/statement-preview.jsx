"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  RotateCcw,
} from "lucide-react";
import { useLocale } from "./locale-provider";
import { preparePdfRuntime } from "@/lib/statements/runtime.mjs";

export default function StatementPreview({ report }) {
  const { locale, t } = useLocale();
  const [result, setResult] = useState(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState("fit");
  const [completedRender, setCompletedRender] = useState(null);
  const canvas = useRef(null),
    textLayer = useRef(null),
    viewport = useRef(null);
  const [width, setWidth] = useState(600);
  const key = `${report.id}:${locale}:${retry}`;
  const ready = result?.key === key;
  const renderKey = `${key}:${pageNumber}:${zoom}:${width}`;
  const rendered = completedRender === renderKey;

  useEffect(() => {
    let active = true,
      document,
      url;
    preparePdfRuntime()
      .then(async (runtime) => {
        const bytes = await runtime.createStatementPdf(report, {
          locale,
          translate: t,
          fontBytes: runtime.fontBytes,
        });
        if (!active) return;
        url = URL.createObjectURL(
          new Blob([bytes], { type: "application/pdf" }),
        );
        document = await runtime.renderer.getDocument({
          data: bytes.slice(),
          worker: runtime.worker,
        }).promise;
        if (!active) {
          await document.destroy();
          URL.revokeObjectURL(url);
          return;
        }
        setPageNumber(1);
        setCompletedRender(null);
        setError(false);
        setResult({ key, document, url, renderer: runtime.renderer });
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
      document?.destroy();
      if (url) URL.revokeObjectURL(url);
    };
  }, [report, locale, t, key]);

  useEffect(() => {
    const observer = new globalThis.ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    if (viewport.current) observer.observe(viewport.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!ready) return;
    let active = true,
      task,
      layer;
    result.document
      .getPage(pageNumber)
      .then(async (page) => {
        if (!active) return;
        const content = await page.getTextContent();
        if (!active) return;
        const natural = page.getViewport({ scale: 1 });
        const scale =
          zoom === "fit"
            ? Math.min(1.4, Math.max(0.2, (width - 32) / natural.width))
            : Number(zoom);
        const view = page.getViewport({ scale });
        const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
        const c = canvas.current,
          element = textLayer.current;
        c.width = Math.floor(view.width * ratio);
        c.height = Math.floor(view.height * ratio);
        c.style.width = `${view.width}px`;
        c.style.height = `${view.height}px`;
        element.style.width = `${view.width}px`;
        element.style.height = `${view.height}px`;
        element.style.setProperty("--scale-factor", scale);
        element.replaceChildren();
        task = page.render({
          canvasContext: c.getContext("2d"),
          viewport: view,
          transform: [ratio, 0, 0, ratio, 0, 0],
        });
        layer = new result.renderer.TextLayer({
          textContentSource: content,
          container: element,
          viewport: view,
        });
        await Promise.all([task.promise, layer.render()]);
        if (active) setCompletedRender(renderKey);
      })
      .catch((err) => {
        if (active && err.name !== "RenderingCancelledException")
          setError(true);
      });
    return () => {
      active = false;
      task?.cancel();
      layer?.cancel();
    };
  }, [ready, result, pageNumber, zoom, width, renderKey]);

  return (
    <section
      className="panel pdf-panel"
      aria-label={t("PDF账单预览")}
      data-snapshot={report.snapshot.snapshot_id}
    >
      <div className="pdf-heading">
        <div className="pdf-document-icon">
          <FileText size={24} />
        </div>
        <div>
          <h2>
            {report.snapshot.period} {t("固定快照")}{" "}
            <span className="chip">v{report.version}</span>
          </h2>
          <p>{t("PDF · 金额与版本已固定")}</p>
        </div>
        <a
          className={`primary ${!ready ? "disabled-link" : ""}`}
          aria-disabled={!ready}
          href={ready ? result.url : undefined}
          download={`wallet-${report.snapshot.period}-${report.id.slice(0, 8)}-${locale}.pdf`}
        >
          <Download size={16} />
          {t("下载PDF")}
        </a>
      </div>
      <div className="pdf-toolbar">
        <div className="pdf-pagination">
          <button
            className="icon-button"
            disabled={!ready || pageNumber <= 1}
            aria-label={t("上一页")}
            onClick={() => setPageNumber((n) => n - 1)}
          >
            <ChevronLeft size={18} />
          </button>
          <span>
            {t("第 {page} 页，共 {total} 页", {
              page: ready ? pageNumber : "-",
              total: ready ? result.document.numPages : "-",
            })}
          </span>
          <button
            className="icon-button"
            disabled={!ready || pageNumber >= result.document.numPages}
            aria-label={t("下一页")}
            onClick={() => setPageNumber((n) => n + 1)}
          >
            <ChevronRight size={18} />
          </button>
        </div>
        <select
          aria-label={t("PDF缩放")}
          value={zoom}
          onChange={(e) => setZoom(e.target.value)}
        >
          <option value="fit">{t("适合页面宽度")}</option>
          <option value="1">100%</option>
          <option value="1.25">125%</option>
          <option value="1.5">150%</option>
        </select>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {t("PDF未能加载，请重试。已保存的账单仍然保留。")}
          <button
            className="secondary"
            onClick={() => {
              setError(false);
              setRetry((n) => n + 1);
            }}
          >
            <RotateCcw size={15} />
            {t("重试")}
          </button>
        </div>
      )}
      <div
        className="pdf-viewport report-preview"
        ref={viewport}
        aria-busy={!ready || !rendered}
        data-ready={ready && rendered ? "true" : "false"}
      >
        {!error && (!ready || !rendered) && (
          <div className="pdf-loading" role="status">
            {t("正在生成PDF预览…")}
          </div>
        )}
        <div className={`pdf-page ${ready ? "" : "pdf-page-pending"}`}>
          <canvas
            ref={canvas}
            aria-label={t("账单PDF第 {page} 页", { page: pageNumber })}
          />
          <div className="pdf-text-layer" ref={textLayer} />
        </div>
      </div>
    </section>
  );
}
