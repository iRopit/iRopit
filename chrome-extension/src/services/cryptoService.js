/**
 * Crypto Service for End-to-End Encryption
 * Cross-platform compatible encryption using symmetric key derivation
 * Must match exactly with React Native cryptoService.ts
 */

// Encryption prefix to identify encrypted strings
const ENCRYPTION_PREFIX = "ENC:";
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

/**
 * Simple hash function for key derivation
 * Must match exactly with React Native version
 */
function simpleHash(str) {
  const hash = [];
  for (let i = 0; i < 32; i++) {
    let h = 0;
    for (let j = 0; j < str.length; j++) {
      h = (h * 31 + str.charCodeAt(j) + i) % 2147483647;
    }
    hash.push(Math.abs(h) % 256);
  }
  return hash;
}

/**
 * Derive a key from userId and salt
 */
function deriveKey(userId, salt) {
  const combined =
    userId +
    Array.from(salt)
      .map((b) => String.fromCharCode(b))
      .join("");
  const hash = simpleHash(combined);
  return new Uint8Array(hash);
}

/**
 * Generate random bytes
 */
function generateRandomBytes(length) {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    return crypto.getRandomValues(new Uint8Array(length));
  }
  // Fallback
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

/**
 * XOR-based encryption
 */
function xorCrypt(data, key, iv) {
  const result = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const keyByte = key[i % key.length];
    const ivByte = iv[i % iv.length];
    const combinedKey = (keyByte + ivByte + i) % 256;
    result[i] = (data[i] + combinedKey) % 256;
  }
  return result;
}

/**
 * XOR-based decryption
 */
function xorDecrypt(data, key, iv) {
  const result = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const keyByte = key[i % key.length];
    const ivByte = iv[i % iv.length];
    const combinedKey = (keyByte + ivByte + i) % 256;
    result[i] = (data[i] - combinedKey + 256) % 256;
  }
  return result;
}

/**
 * Convert string to Uint8Array
 */
function stringToBytes(str) {
  const encoder = new TextEncoder();
  return encoder.encode(str);
}

/**
 * Convert Uint8Array to string
 */
function bytesToString(bytes) {
  const decoder = new TextDecoder();
  return decoder.decode(bytes);
}

/**
 * Convert Uint8Array to Base64 string
 */
function arrayToBase64(array) {
  let binary = "";
  for (let i = 0; i < array.length; i++) {
    binary += String.fromCharCode(array[i]);
  }
  return btoa(binary);
}

/**
 * Convert Base64 string to Uint8Array
 */
function base64ToArray(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encrypt a string
 * @param {string} plaintext - Text to encrypt
 * @param {string} userId - User ID for key derivation
 * @returns {Promise<string>} Encrypted data as Base64 (ENC:base64)
 */
export async function encrypt(plaintext, userId) {
  if (!plaintext || !userId) {
    return plaintext;
  }

  try {
    const salt = generateRandomBytes(SALT_LENGTH);
    const iv = generateRandomBytes(IV_LENGTH);
    const key = deriveKey(userId, salt);

    const data = stringToBytes(plaintext);
    const encrypted = xorCrypt(data, key, iv);

    // Combine salt + iv + encrypted data
    const combined = new Uint8Array(salt.length + iv.length + encrypted.length);
    combined.set(salt, 0);
    combined.set(iv, salt.length);
    combined.set(encrypted, salt.length + iv.length);

    return ENCRYPTION_PREFIX + arrayToBase64(combined);
  } catch (error) {
    console.error("[Crypto] Encryption error:", error);
    return plaintext;
  }
}

/**
 * Decrypt a string
 * @param {string} encryptedData - Encrypted data (ENC:base64)
 * @param {string} userId - User ID for key derivation
 * @returns {Promise<string>} Decrypted plaintext
 */
export async function decrypt(encryptedData, userId) {
  if (!encryptedData || !userId) {
    return encryptedData;
  }

  // Check if data is encrypted
  if (!encryptedData.startsWith(ENCRYPTION_PREFIX)) {
    return encryptedData;
  }

  try {
    const combined = base64ToArray(
      encryptedData.slice(ENCRYPTION_PREFIX.length),
    );

    // Extract salt, iv, and ciphertext
    const salt = combined.slice(0, SALT_LENGTH);
    const iv = combined.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const ciphertext = combined.slice(SALT_LENGTH + IV_LENGTH);

    const key = deriveKey(userId, salt);
    const decrypted = xorDecrypt(ciphertext, key, iv);

    return bytesToString(decrypted);
  } catch (error) {
    console.error("[Crypto] Decryption error:", error);
    return encryptedData;
  }
}

/**
 * Encrypt an object's sensitive fields
 * @param {Object} data - Object to encrypt
 * @param {string} userId - User ID for key derivation
 * @param {string[]} fields - Fields to encrypt
 * @returns {Promise<Object>} Object with encrypted fields
 */
export async function encryptFields(data, userId, fields) {
  if (!data || !userId) return data;

  const encrypted = { ...data };

  for (const field of fields) {
    if (encrypted[field] && typeof encrypted[field] === "string") {
      encrypted[field] = await encrypt(encrypted[field], userId);
    }
  }

  return encrypted;
}

/**
 * Decrypt an object's encrypted fields
 * @param {Object} data - Object to decrypt
 * @param {string} userId - User ID for key derivation
 * @param {string[]} fields - Fields to decrypt
 * @returns {Promise<Object>} Object with decrypted fields
 */
export async function decryptFields(data, userId, fields) {
  if (!data || !userId) return data;

  const decrypted = { ...data };

  // Decrypt all fields in parallel for better performance
  const decryptPromises = fields
    .filter((field) => decrypted[field] && typeof decrypted[field] === "string")
    .map(async (field) => {
      decrypted[field] = await decrypt(decrypted[field], userId);
    });

  await Promise.all(decryptPromises);

  return decrypted;
}

/**
 * Check if a string is encrypted
 * @param {string} str - String to check
 * @returns {boolean} True if encrypted
 */
export function isEncrypted(str) {
  return typeof str === "string" && str.startsWith(ENCRYPTION_PREFIX);
}

// Field definitions for different data types
export const ENCRYPTED_FIELDS = {
  chat: ["content", "fileName", "fileUrl"],
  sms: [
    "body",
    "address",
    "displayName",
    "text",
    "title",
    "phoneNumber",
    "contactName",
  ],
  call: ["phoneNumber", "contactName", "displayName", "title", "number", "address", "name"],
  notification: ["title", "body", "text"],
  contact: ["name", "phoneNumber", "email"],
};

/**
 * Encrypt chat message
 * @param {Object} message - Chat message
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Encrypted message
 */
export async function encryptChatMessage(message, userId) {
  return encryptFields(message, userId, ENCRYPTED_FIELDS.chat);
}

/**
 * Decrypt chat message
 * @param {Object} message - Encrypted chat message
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Decrypted message
 */
export async function decryptChatMessage(message, userId) {
  return decryptFields(message, userId, ENCRYPTED_FIELDS.chat);
}

/**
 * Encrypt SMS
 * @param {Object} sms - SMS data
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Encrypted SMS
 */
export async function encryptSMS(sms, userId) {
  return encryptFields(sms, userId, ENCRYPTED_FIELDS.sms);
}

/**
 * Decrypt SMS
 * @param {Object} sms - Encrypted SMS
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Decrypted SMS
 */
export async function decryptSMS(sms, userId) {
  return decryptFields(sms, userId, ENCRYPTED_FIELDS.sms);
}

/**
 * Encrypt call log
 * @param {Object} call - Call data
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Encrypted call
 */
export async function encryptCall(call, userId) {
  return encryptFields(call, userId, ENCRYPTED_FIELDS.call);
}

/**
 * Decrypt call log
 * @param {Object} call - Encrypted call
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Decrypted call
 */
export async function decryptCall(call, userId) {
  return decryptFields(call, userId, ENCRYPTED_FIELDS.call);
}

/**
 * Encrypt notification
 * @param {Object} notification - Notification data
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Encrypted notification
 */
export async function encryptNotification(notification, userId) {
  return encryptFields(notification, userId, ENCRYPTED_FIELDS.notification);
}

/**
 * Decrypt notification
 * @param {Object} notification - Encrypted notification
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Decrypted notification
 */
export async function decryptNotification(notification, userId) {
  return decryptFields(notification, userId, ENCRYPTED_FIELDS.notification);
}

export default {
  encrypt,
  decrypt,
  encryptFields,
  decryptFields,
  isEncrypted,
  ENCRYPTED_FIELDS,
  encryptChatMessage,
  decryptChatMessage,
  encryptSMS,
  decryptSMS,
  encryptCall,
  decryptCall,
  encryptNotification,
  decryptNotification,
};
