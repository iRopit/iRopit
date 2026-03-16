const ENCRYPTION_PREFIX = "ENC:";
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

function simpleHash(str: string): number[] {
  const hash: number[] = [];
  for (let i = 0; i < 32; i++) {
    let h = 0;
    for (let j = 0; j < str.length; j++) {
      h = (h * 31 + str.charCodeAt(j) + i) % 2147483647;
    }
    hash.push(Math.abs(h) % 256);
  }
  return hash;
}

function deriveKey(userId: string, salt: Uint8Array): Uint8Array {
  const combined =
    userId +
    Array.from(salt)
      .map((b) => String.fromCharCode(b))
      .join("");
  const hash = simpleHash(combined);
  return new Uint8Array(hash);
}

function xorDecrypt(
  data: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
): Uint8Array {
  const result = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const keyByte = key[i % key.length];
    const ivByte = iv[i % iv.length];
    const combinedKey = (keyByte + ivByte + i) % 256;
    result[i] = (data[i] - combinedKey + 256) % 256;
  }
  return result;
}

function xorCrypt(
  data: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
): Uint8Array {
  const result = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const keyByte = key[i % key.length];
    const ivByte = iv[i % iv.length];
    const combinedKey = (keyByte + ivByte + i) % 256;
    result[i] = (data[i] + combinedKey) % 256;
  }
  return result;
}

function arrayToBase64(array: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < array.length; i++) {
    binary += String.fromCharCode(array[i]);
  }
  return btoa(binary);
}

function base64ToArray(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function encrypt(
  plaintext: string,
  userId: string,
): Promise<string> {
  if (!plaintext || !userId) return plaintext;
  try {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const key = deriveKey(userId, salt);
    const data = new TextEncoder().encode(plaintext);
    const encrypted = xorCrypt(data, key, iv);
    const combined = new Uint8Array(salt.length + iv.length + encrypted.length);
    combined.set(salt, 0);
    combined.set(iv, salt.length);
    combined.set(encrypted, salt.length + iv.length);
    return ENCRYPTION_PREFIX + arrayToBase64(combined);
  } catch {
    return plaintext;
  }
}

export async function decrypt(
  encryptedData: string,
  userId: string,
): Promise<string> {
  if (!encryptedData || !userId) return encryptedData;
  if (!encryptedData.startsWith(ENCRYPTION_PREFIX)) return encryptedData;
  try {
    const combined = base64ToArray(
      encryptedData.slice(ENCRYPTION_PREFIX.length),
    );
    const salt = combined.slice(0, SALT_LENGTH);
    const iv = combined.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const ciphertext = combined.slice(SALT_LENGTH + IV_LENGTH);
    const key = deriveKey(userId, salt);
    const decrypted = xorDecrypt(ciphertext, key, iv);
    return new TextDecoder().decode(decrypted);
  } catch (error) {
    console.error(
      "[Crypto] Decryption failed:",
      error,
      "| Data prefix:",
      encryptedData.slice(0, 30),
    );
    return encryptedData;
  }
}
