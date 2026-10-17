import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

// Next extracts the request nonce and applies it to its rendered scripts.
// RootLayout reads cookies, so workspace routes are dynamically rendered.
export function proxy(request) {
  const nonce = randomBytes(24).toString("base64");
  const dev = process.env.NODE_ENV !== "production";
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // Charts/PDF sizing use style attributes; scripts still require a nonce.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? " ws://127.0.0.1:* ws://localhost:*" : ""}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
  const headers = new Headers(request.headers);
  headers.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", policy);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: [
    "/",
    "/demo",
    "/dashboard",
    "/transaction/:path*",
    "/sign-in/:path*",
    "/sign-up/:path*",
    "/account/:path*",
  ],
};
