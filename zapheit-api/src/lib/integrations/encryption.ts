import crypto from 'crypto';

function deriveKey(raw: string): Buffer {
  // Accept base64, hex, or plain strings; normalize to 32 bytes via SHA-256.
  const trimmed = raw.trim();
  try {
    if (/^[A-Fa-f0-9]{64}$/.test(trimmed)) {
      return Buffer.from(trimmed, 'hex');
    }
    // If it's valid base64, this will decode; otherwise it will throw and we fall through.
    const decoded = Buffer.from(trimmed, 'base64');
    if (decoded.length >= 32) {
      return decoded.subarray(0, 32);
    }
  } catch {
    // ignore
  }
  return crypto.createHash('sha256').update(trimmed).digest();
}

function getEncryptionKey(): Buffer {
  const key =
    process.env.INTEGRATIONS_ENCRYPTION_KEY ||
    process.env.ENCRYPTION_KEY ||
    '';

  if (key.trim().length > 0) {
    return deriveKey(key);
  }

  // Development fallback: derive from JWT_SECRET so local setups still work.
  // Production must set INTEGRATIONS_ENCRYPTION_KEY explicitly.
  const fallback = process.env.JWT_SECRET || '';
  return deriveKey(fallback || 'zapheit-dev-fallback');
}

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const key = getEncryptionKey();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // v1:<base64(iv)>:<base64(tag)>:<base64(ciphertext)>
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

export function decryptSecret(payload: string): string {
  if (!payload) return '';
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    // Backward-compat / dev mode: treat as plaintext.
    return payload;
  }
  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const ciphertext = Buffer.from(parts[3], 'base64');
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

