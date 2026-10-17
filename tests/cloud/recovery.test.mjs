import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createRecoveryMarker,
  verifyRecoveryMarker,
} from "../../lib/cloud/recovery-token.mjs";
const secret = "synthetic-recovery-key-at-least-32-characters",
  at = 1792022400000;
test("recovery is bound to the verified token, key and five-minute window", () => {
  const marker = createRecoveryMarker(secret, "synthetic-session-a", at);
  assert.equal(
    verifyRecoveryMarker(secret, marker, "synthetic-session-a", at + 299999),
    true,
  );
  assert.equal(
    verifyRecoveryMarker(secret, marker, "synthetic-session-b", at + 100),
    false,
  );
  assert.equal(
    verifyRecoveryMarker(
      secret + "changed",
      marker,
      "synthetic-session-a",
      at + 100,
    ),
    false,
  );
  assert.equal(
    verifyRecoveryMarker(secret, marker, "synthetic-session-a", at + 300001),
    false,
  );
  assert.equal(
    verifyRecoveryMarker(secret, marker, "synthetic-session-a", at - 1001),
    false,
  );
});
test("malformed and example recovery secrets fail closed", () => {
  assert.throws(() =>
    createRecoveryMarker(
      "replace-with-at-least-32-random-characters",
      "token",
      at,
    ),
  );
  for (const marker of [null, "", {}, "123.bad", `${at}.` + "0".repeat(64)])
    assert.equal(verifyRecoveryMarker(secret, marker, "token", at), false);
});
