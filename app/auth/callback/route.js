import { cloudClient, cloudConfig } from "@/lib/cloud/supabase.mjs";
import { recoveryMarker } from "@/lib/cloud/recovery.mjs";
import { cookies } from "next/headers";
export const dynamic = "force-dynamic";
export async function GET(request) {
  if (process.env.WALLET_UI_MODE !== "cloud")
    return Response.json({ error: { code: "NOT_AVAILABLE" } }, { status: 404 });
  try {
    const url = new URL(request.url),
      config = cloudConfig(),
      code = url.searchParams.get("code");
    if (code) {
      const client = await cloudClient(),
        { error } = await client.auth.exchangeCodeForSession(code);
      if (!error) {
        const recovery = url.searchParams.get("next") === "recovery";
        if (recovery) {
          const session = (await client.auth.getSession()).data.session;
          if (!session) throw new Error("No recovery session");
          (await cookies()).set(
            "zz-recovery",
            recoveryMarker(session.access_token),
            {
              httpOnly: true,
              secure: config.origin.startsWith("https:"),
              sameSite: "lax",
              path: "/",
              maxAge: 300,
            },
          );
        }
        return Response.redirect(
          config.origin + (recovery ? "/account/recovery" : "/"),
          303,
        );
      }
    }
  } catch {
    /* no provider errors, codes or tokens in the response */
  }
  return Response.json(
    {
      error: {
        code: "AUTH_CALLBACK_FAILED",
        message:
          "The verification link is invalid or expired. Request a new link.",
      },
    },
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );
}
