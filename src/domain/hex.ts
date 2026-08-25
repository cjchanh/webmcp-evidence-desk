/**
 * Minimal hex helpers — avoids an extra dependency on @noble/hashes utils.
 */

export function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) {
    out += b.toString(16).padStart(2, '0')
  }
  return out
}

export function hexToBytes(hex: string): Uint8Array {
  if (typeof hex !== 'string' || hex.length === 0 || hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) {
    throw new TypeError('invalid hex string')
  }
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

export function utf8Bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

/** sha256 hex of utf8 text via WebCrypto — browser AND Node >= 18. */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = utf8Bytes(text) as Uint8Array<ArrayBuffer>
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return bytesToHex(new Uint8Array(digest))
}
