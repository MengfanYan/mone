import "server-only";
import { createHash } from "node:crypto";
import { cloudClient, cloudConfig } from "./supabase.mjs";
import { verifyRecovery } from "./recovery.mjs";
import { cookies } from "next/headers";
import { mfaAction } from "./mfa.mjs";

const attempts = new Map();
const reply = (body, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
const fail = (code, message, status) =>
  reply({ error: { code, message } }, status);
function limit(email) {
  const now = Date.now(),
    key = createHash("sha256")
      .update(String(email).trim().toLowerCase())
      .digest("hex");
  for (const [id, value] of attempts)
    if (value.at < now - 60000) attempts.delete(id);
  const current = attempts.get(key) || { at: now, count: 0 };
  if (current.count >= 5 || attempts.size >= 5000) return false;
  attempts.set(key, { ...current, count: current.count + 1 });
  return true;
}

export async function cloudProxy(request, path) {
  let config;
  try {
    config = cloudConfig();
  } catch {
    return fail(
      "CLOUD_CONFIG",
      "Cloud authentication has not been configured",
      503,
    );
  }
  if (
    request.method !== "GET" &&
    request.method !== "HEAD" &&
    request.headers.get("origin") !== config.origin
  )
    return fail("ORIGIN_FORBIDDEN", "A same-origin request is required", 403);
  if (!path.every((p) => /^[a-zA-Z0-9_-]+$/.test(p)))
    return fail("INVALID_PATH", "Invalid request path", 400);
  const input = new URL(request.url),
    name = path.join("/");
  if (name === "auth/config" && request.method === "GET")
    return reply({
      data: {
        signup: process.env.CLOUD_PUBLIC_SIGNUP === "true",
        billing: false,
      },
    });
  const raw = ["GET", "HEAD"].includes(request.method)
    ? undefined
    : await request.text();
  if (raw && Buffer.byteLength(raw) > 7_100_000)
    return fail("REQUEST_LIMIT", "Request body is too large", 413);
  const authAction =
    (name === "session" && request.method === "POST") ||
    name.startsWith("auth/");
  const client = await cloudClient();
  if (name.startsWith("auth/mfa/") && request.method === "POST") {
    const user = await client.auth.getUser(),
      session = (await client.auth.getSession()).data.session;
    if (user.error || !user.data.user || !session)
      return fail("UNAUTHENTICATED", "Sign in again", 401);
    const port = process.env.API_PORT || "8766";
    if (!/^\d{2,5}$/.test(port))
      return fail("CLOUD_CONFIG", "Cloud API configuration is invalid", 503);
    const active = await fetch(`http://127.0.0.1:${port}/v1/session`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    }).catch(() => null);
    if (!active?.ok)
      return fail(
        "UNAUTHENTICATED",
        "The device session is unavailable or revoked",
        401,
      );
    let body;
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      return fail("INVALID_JSON", "Invalid authenticator request", 400);
    }
    if (!body || Array.isArray(body) || (raw?.length || 0) > 2000)
      return fail("INVALID_REQUEST", "Invalid authenticator request", 400);
    return mfaAction(client, name.slice("auth/mfa/".length), body);
  }
  if (authAction) {
    if (request.method !== "POST" || (raw?.length || 0) > 16000)
      return fail("INVALID_REQUEST", "Invalid authentication request", 400);
    let body;
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      return fail("INVALID_JSON", "Invalid authentication request", 400);
    }
    if (name === "auth/reset") {
      if (
        !body ||
        Object.keys(body).join() !== "password" ||
        typeof body.password !== "string" ||
        body.password.length < 12 ||
        body.password.length > 200
      )
        return fail(
          "PASSWORD_POLICY",
          "Use a password of 12–200 characters",
          400,
        );
      const checked = await client.auth.getUser(),
        session = (await client.auth.getSession()).data.session,
        jar = await cookies();
      const marker = jar.get("zz-recovery")?.value;
      jar.delete("zz-recovery");
      if (
        checked.error ||
        !checked.data.user ||
        !session ||
        !verifyRecovery(marker, session.access_token)
      )
        return fail(
          "RECOVERY_EXPIRED",
          "Request a new password recovery email",
          401,
        );
      const apiPort = process.env.API_PORT || "8766";
      if (!/^\d{2,5}$/.test(apiPort))
        return fail("CLOUD_CONFIG", "Cloud API configuration is invalid", 503);
      const revoked = await fetch(
        `http://127.0.0.1:${apiPort}/v1/account/sessions/revoke-all`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: config.origin,
            Authorization: `Bearer ${session.access_token}`,
          },
          body: "{}",
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(10000),
        },
      ).catch(() => null);
      if (!revoked?.ok)
        return fail(
          "AUTH_UNAVAILABLE",
          "Device sessions could not be revoked. Request a new recovery email and retry later.",
          503,
        );
      const { error } = await client.auth.updateUser({
        password: body.password,
      });
      if (error)
        return fail(
          "RECOVERY_FAILED",
          "The password could not be updated; request a new recovery email",
          400,
        );
      await client.auth.signOut({ scope: "global" });
      return reply({ data: { updated: true } });
    }
    if (
      !body ||
      Array.isArray(body) ||
      Object.keys(body).some(
        (k) => !["email", "password", "captchaToken"].includes(k),
      ) ||
      typeof body.email !== "string" ||
      body.email.length > 254 ||
      !limit(body.email)
    )
      return fail("AUTH_RATE_LIMIT", "Wait a minute before trying again", 429);
    if (name === "auth/recover") {
      await client.auth.resetPasswordForEmail(body.email, {
        redirectTo: config.origin + "/auth/callback?next=recovery",
        captchaToken: body.captchaToken,
      });
      return reply({
        data: {
          message:
            "If this address can receive recovery mail, instructions have been sent.",
        },
      });
    }
    if (
      typeof body.password !== "string" ||
      body.password.length < 1 ||
      body.password.length > 200
    )
      return fail("AUTH_INVALID", "Enter your email and password", 400);
    if (name === "auth/sign-up") {
      if (process.env.CLOUD_PUBLIC_SIGNUP !== "true")
        return fail(
          "SIGNUP_CLOSED",
          "Public registration is not open; use an invited account or the synthetic Demo",
          403,
        );
      if (body.password.length < 12)
        return fail(
          "PASSWORD_POLICY",
          "Use a password of at least 12 characters",
          400,
        );
      const { error } = await client.auth.signUp({
        email: body.email,
        password: body.password,
        options: {
          emailRedirectTo: config.origin + "/auth/callback",
          captchaToken: body.captchaToken,
        },
      });
      if (error)
        return fail(
          "SIGNUP_UNAVAILABLE",
          "Registration could not be completed. Check your details or try later.",
          400,
        );
      return reply({
        data: {
          message: "Check your email to verify your account before signing in.",
        },
      });
    }
    if (name !== "session")
      return fail("NOT_FOUND", "Authentication action is unavailable", 404);
    const { error } = await client.auth.signInWithPassword({
      email: body.email,
      password: body.password,
      options: { captchaToken: body.captchaToken },
    });
    if (error)
      return fail(
        "AUTH_INVALID",
        "Unable to sign in. Verify your email and password.",
        401,
      );
    const assurance = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (
      assurance.data?.nextLevel === "aal2" &&
      assurance.data?.currentLevel !== "aal2"
    ) {
      const factors = await client.auth.mfa.listFactors();
      return reply({
        data: {
          authenticated: false,
          needs_mfa: true,
          factors: (factors.data?.totp || []).map((f) => ({
            id: f.id,
            name: f.friendly_name || "Authenticator",
          })),
        },
      });
    }
    return reply({ data: { authenticated: true } });
  }
  let token;
  if (name !== "health") {
    // getSession is used only for transport AFTER identity was checked remotely.
    const { data, error } = await client.auth.getUser();
    if (error || !data.user || data.user.is_anonymous)
      return fail("UNAUTHENTICATED", "Sign in to your cloud account", 401);
    token = (await client.auth.getSession()).data.session?.access_token;
    if (!token)
      return fail("UNAUTHENTICATED", "Sign in to your cloud account", 401);
  }
  const port = process.env.API_PORT || "8766";
  if (!/^\d{2,5}$/.test(port))
    return fail("CLOUD_CONFIG", "Cloud API configuration is invalid", 503);
  try {
    const headers = {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` }),
    };
    for (const key of ["origin", "idempotency-key", "accept-language"])
      if (request.headers.has(key)) headers[key] = request.headers.get(key);
    const upstream = await fetch(
      `http://127.0.0.1:${port}/v1/${name}${input.search}`,
      {
        method: request.method,
        body: raw,
        headers,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(35000),
      },
    );
    if (name === "session" && request.method === "DELETE" && upstream.ok)
      await client.auth.signOut({ scope: "local" });
    if (name === "privacy/delete" && upstream.ok)
      await client.auth.signOut({ scope: "global" });
    if (
      name.startsWith("documents/") &&
      name.endsWith("/download") &&
      upstream.ok
    )
      return new Response(await upstream.arrayBuffer(), {
        status: 200,
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": "attachment; filename=private-document.bin",
          "Cache-Control": "private, no-store",
        },
      });
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return fail(
      "API_UNAVAILABLE",
      "Cloud services are temporarily unavailable. Your records have not been replaced with Demo data.",
      503,
    );
  }
}
