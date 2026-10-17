import { createHmac, timingSafeEqual } from "node:crypto";
const validSecret = (secret) =>
  typeof secret === "string" &&
  secret.length >= 32 &&
  !secret.startsWith("replace");
export function createRecoveryMarker(secret, token, at = Date.now()) {
  if (!validSecret(secret))
    throw new Error("Recovery protection is not configured");
  const time = String(at),
    signature = createHmac("sha256", secret)
      .update(`recovery|${time}|${token}`)
      .digest("hex");
  return `${time}.${signature}`;
}
export function verifyRecoveryMarker(secret, marker, token, now = Date.now()) {
  if (
    !validSecret(secret) ||
    typeof marker !== "string" ||
    !/^\d{13}\.[a-f0-9]{64}$/.test(marker)
  )
    return false;
  const at = Number(marker.split(".")[0]);
  if (now - at > 300000 || at > now + 1000) return false;
  return timingSafeEqual(
    Buffer.from(marker),
    Buffer.from(createRecoveryMarker(secret, token, at)),
  );
}
