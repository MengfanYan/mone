import "server-only";
import { createRecoveryMarker,verifyRecoveryMarker } from "./recovery-token.mjs";
export function recoveryMarker(token, at = Date.now()) {
  return createRecoveryMarker(process.env.CLOUD_AUTH_FLOW_SECRET,token,at);
}
export function verifyRecovery(marker, token) {
  return verifyRecoveryMarker(process.env.CLOUD_AUTH_FLOW_SECRET,marker,token);
}
