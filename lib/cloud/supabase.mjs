import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export function cloudConfig() {
  const url = process.env.SUPABASE_URL || "";
  const origin = process.env.CLOUD_PUBLIC_ORIGIN || "";
  if (
    !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) ||
    !process.env.SUPABASE_PUBLISHABLE_KEY ||
    (process.env.CLOUD_AUTH_FLOW_SECRET || "").length < 32 ||
    process.env.CLOUD_AUTH_FLOW_SECRET.startsWith("replace") ||
    !/^https:\/\/[^/?#]+$|^http:\/\/(?:localhost|127\.0\.0\.1):\d{4,5}$/.test(
      origin,
    )
  )
    throw new Error("Cloud authentication is not configured");
  return { url, origin, key: process.env.SUPABASE_PUBLISHABLE_KEY };
}

export async function cloudClient() {
  const config = cloudConfig(),
    jar = await cookies();
  return createServerClient(config.url, config.key, {
    cookieOptions: {
      httpOnly: true,
      secure: config.origin.startsWith("https:"),
      sameSite: "lax",
      path: "/",
    },
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (values) =>
        values.forEach(({ name, value, options }) =>
          jar.set(name, value, {
            ...options,
            httpOnly: true,
            secure: config.origin.startsWith("https:"),
            sameSite: "lax",
            path: "/",
          }),
        ),
    },
  });
}
