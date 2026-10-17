import { translate } from "@/lib/i18n";
import { cloudProxy } from "@/lib/cloud/bff.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function proxy(request, context) {
  if (process.env.WALLET_UI_MODE === "cloud") {
    const { path } = await context.params;
    return cloudProxy(request, path);
  }
  const locale = request.headers
    .get("accept-language")
    ?.toLowerCase()
    .startsWith("zh")
    ? "zh"
    : "en";
  const t = (message) => translate(message, locale);
  if (process.env.WALLET_UI_MODE === "demo") {
    return Response.json(
      {
        error: {
          code: "DEMO_API_DISABLED",
          message: t("演示版本使用浏览器预设，正式API在此启动模式下关闭。"),
        },
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store", "Content-Language": locale },
      },
    );
  }
  const { path } = await context.params;
  if (!path.every((segment) => /^[a-zA-Z0-9_-]+$/.test(segment))) {
    return Response.json(
      { error: { code: "INVALID_PATH", message: t("请求路径无效。") } },
      { status: 400 },
    );
  }
  const input = new URL(request.url);
  const apiPort = process.env.API_PORT || "8765";
  if (!/^\d{2,5}$/.test(apiPort)) {
    return Response.json(
      { error: { code: "API_CONFIG", message: t("API端口配置无效。") } },
      { status: 503 },
    );
  }
  const headers = new Headers({ "Content-Type": "application/json" });
  for (const key of [
    "cookie",
    "origin",
    "idempotency-key",
    "accept-language",
  ]) {
    const value = request.headers.get(key);
    if (value) headers.set(key, value);
  }
  try {
    const size = Number(request.headers.get("content-length") || "0");
    if (size > 7_100_000)
      return Response.json(
        { error: { code: "REQUEST_LIMIT", message: t("文件超限。") } },
        { status: 413 },
      );
    const body = ["GET", "HEAD"].includes(request.method)
      ? undefined
      : await request.text();
    if (body && Buffer.byteLength(body) > 7_100_000)
      return Response.json(
        { error: { code: "REQUEST_LIMIT", message: t("文件超限。") } },
        { status: 413 },
      );
    const result = await fetch(
      `http://127.0.0.1:${apiPort}/v1/${path.join("/")}${input.search}`,
      {
        method: request.method,
        headers,
        body,
        cache: "no-store",
        signal: AbortSignal.timeout(35000),
        redirect: "error",
      },
    );
    const outputHeaders = new Headers({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    const cookie = result.headers.get("set-cookie");
    outputHeaders.set(
      "Content-Language",
      result.headers.get("content-language") || "en",
    );
    if (cookie) outputHeaders.set("Set-Cookie", cookie);
    return new Response(await result.text(), {
      status: result.status,
      headers: outputHeaders,
    });
  } catch {
    return Response.json(
      {
        error: {
          code: "API_UNAVAILABLE",
          message: t("本地服务未启动或超时。请在项目目录运行 npm run dev。"),
        },
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
