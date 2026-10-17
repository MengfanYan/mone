const aad = new globalThis.TextEncoder().encode("zhizhang-backup-v1");
const bytes64 = (value) =>
  globalThis.btoa(Array.from(value, (b) => String.fromCharCode(b)).join(""));
const from64 = (value) =>
  Uint8Array.from(globalThis.atob(value), (c) => c.charCodeAt(0));
async function derive(password, salt, iterations) {
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 200
  )
    throw new Error("Use a backup password of 12–200 characters.");
  const material = await crypto.subtle.importKey(
    "raw",
    new globalThis.TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
export async function encryptBackup(value, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16)),
    iv = crypto.getRandomValues(new Uint8Array(12)),
    iterations = 600000;
  const key = await derive(password, salt, iterations);
  const plain = new globalThis.TextEncoder().encode(JSON.stringify(value));
  if (plain.length > 32 * 1024 * 1024) {
    plain.fill(0);
    throw new Error("Encrypted backup exceeds the 32 MiB plaintext limit.");
  }
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad, tagLength: 128 },
    key,
    plain,
  );
  plain.fill(0);
  return {
    format: "zhizhang-encrypted-backup",
    version: 1,
    algorithm: "AES-256-GCM",
    kdf: "PBKDF2-SHA256",
    iterations,
    salt: bytes64(salt),
    iv: bytes64(iv),
    ciphertext: bytes64(new Uint8Array(encrypted)),
  };
}
export async function inspectEncryptedBackup(envelope, password) {
  if (
    envelope?.format !== "zhizhang-encrypted-backup" ||
    envelope.version !== 1 ||
    envelope.algorithm !== "AES-256-GCM" ||
    envelope.kdf !== "PBKDF2-SHA256" ||
    envelope.iterations !== 600000 ||
    typeof envelope.ciphertext !== "string" ||
    envelope.ciphertext.length > 50 * 1024 * 1024
  )
    throw new Error("Unsupported encrypted backup.");
  const salt = from64(envelope.salt),
    iv = from64(envelope.iv);
  if (salt.length !== 16 || iv.length !== 12)
    throw new Error("Invalid encrypted backup.");
  const key = await derive(password, salt, envelope.iterations);
  const data = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: aad, tagLength: 128 },
    key,
    from64(envelope.ciphertext),
  );
  try {
    return JSON.parse(new globalThis.TextDecoder().decode(data));
  } finally {
    new Uint8Array(data).fill(0);
  }
}
