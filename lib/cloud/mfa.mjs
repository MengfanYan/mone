import "server-only";
export async function mfaAction(client, action, data) {
  const fail = (message, status = 400) =>
    Response.json(
      { error: { code: "MFA_ACTION", message } },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  const ok = (value) =>
    Response.json(
      { data: value },
      { headers: { "Cache-Control": "no-store" } },
    );
  if (action === "list") {
    const { data: items, error } = await client.auth.mfa.listFactors();
    const assurance = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    return error
      ? fail("Could not load authenticators")
      : ok({
          factors: items.totp.map((f) => ({
            id: f.id,
            name: f.friendly_name || "Authenticator",
            status: f.status,
          })),
          assurance: assurance.data?.currentLevel,
        });
  }
  if (action === "enroll") {
    const assurance=await client.auth.mfa.getAuthenticatorAssuranceLevel();
    if(assurance.data?.nextLevel==="aal2" && assurance.data?.currentLevel!=="aal2") return fail("Verify an existing authenticator before enrolling another",403);
    if (Object.keys(data).length) return fail("No extra data is accepted");
    const { data: factor, error } = await client.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "ZhiZhang authenticator",
    });
    return error
      ? fail("Could not begin authenticator setup")
      : ok({ id: factor.id, secret: factor.totp.secret });
  }
  if (
    !data ||
    Object.keys(data).some((k) => !["factor_id", "code"].includes(k)) ||
    typeof data.factor_id !== "string" ||
    !/^[a-f0-9-]{36}$/.test(data.factor_id) ||
    typeof data.code !== "string" ||
    !/^\d{6}$/.test(data.code)
  )
    return fail("Enter a valid six-digit authenticator code");
  const challenge = await client.auth.mfa.challenge({
    factorId: data.factor_id,
  });
  if (challenge.error) return fail("Could not verify this authenticator");
  const checked = await client.auth.mfa.verify({
    factorId: data.factor_id,
    challengeId: challenge.data.id,
    code: data.code,
  });
  if (checked.error)
    return fail("The authenticator code is invalid or expired");
  if (action === "unenroll") {
    const removed = await client.auth.mfa.unenroll({
      factorId: data.factor_id,
    });
    return removed.error
      ? fail("Could not remove this authenticator")
      : ok({ removed: true });
  }
  if (action !== "verify")
    return fail("This authenticator action is unavailable", 404);
  return ok({ verified: true, assurance: "aal2" });
}
