import { chacha20poly1305 } from '@noble/ciphers/chacha';
import { x25519 } from '@noble/curves/ed25519';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes, keccak256, type Address, type Hex } from 'viem';

/**
 * Audit envelope: the holder's credential data for one transfer, encrypted to
 * the auditor ("proof + data" audit model).
 *
 * The proof alone tells the market a transfer was compliant. The envelope lets
 * an entitled auditor re-derive that conclusion independently from the
 * underlying data. Its keccak-256 hash is folded into the proof's binding, so
 * the envelope cannot be swapped or altered after the proof is made.
 *
 * Wire format (version 1):
 *   0x01 | ephemeral X25519 public key (32) | nonce (12) | ChaCha20-Poly1305 ciphertext + tag
 * Key derivation: HKDF-SHA256 over the X25519 shared secret, salted with both public keys.
 * Associated data: the holder's address, so an envelope cannot be replayed for another holder.
 */

export const ENVELOPE_VERSION = 1;
const INFO = new TextEncoder().encode('provable-compliance/audit-envelope/v1');

/**
 * Development auditor key pair. In production the private key would sit with
 * the supervisor (ideally split across parties, see Layer 6 of the note); only
 * the public key is distributed to wallets.
 */
export const AUDITOR_PUBLIC_KEY: Hex = '0xfe426064247612fde70e0ed58fac634b3d895221d4eeb292187a233bbf0e9749';

export interface EnvelopePayload {
  v: 1;
  caseId: string;
  holder: Address;
  country: number;
  investorClass: number;
  expiry: string;
  salt: string;
  leafIndex: number;
  /** Merkle path as decimal strings. */
  path: string[];
  /** Registry root the holder proved against, as 0x field hex. */
  proofRoot: Hex;
  policyVersion: number;
  to: Address;
  amount: string;
  nonce: string;
}

function deriveKey(shared: Uint8Array, ephPub: Uint8Array, recipientPub: Uint8Array): Uint8Array {
  const salt = new Uint8Array(64);
  salt.set(ephPub, 0);
  salt.set(recipientPub, 32);
  return hkdf(sha256, shared, salt, INFO, 32);
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

export function encryptEnvelope(payload: EnvelopePayload, recipientPublicKey: Hex = AUDITOR_PUBLIC_KEY): Hex {
  const recipientPub = hexToBytes(recipientPublicKey);
  const ephPriv = randomBytes(32);
  const ephPub = x25519.getPublicKey(ephPriv);
  const key = deriveKey(x25519.getSharedSecret(ephPriv, recipientPub), ephPub, recipientPub);
  const nonce = randomBytes(12);
  const aad = hexToBytes(payload.holder.toLowerCase() as Hex);
  const ct = chacha20poly1305(key, nonce, aad).encrypt(new TextEncoder().encode(JSON.stringify(payload)));
  const out = new Uint8Array(1 + 32 + 12 + ct.length);
  out[0] = ENVELOPE_VERSION;
  out.set(ephPub, 1);
  out.set(nonce, 33);
  out.set(ct, 45);
  return bytesToHex(out);
}

export class EnvelopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvelopeError';
  }
}

export function decryptEnvelope(envelope: Hex, recipientPrivateKey: Hex, holder: Address): EnvelopePayload {
  const bytes = hexToBytes(envelope);
  if (bytes.length < 45 + 16) throw new EnvelopeError('Envelope too short');
  if (bytes[0] !== ENVELOPE_VERSION) throw new EnvelopeError(`Unsupported envelope version ${bytes[0]}`);
  const priv = hexToBytes(recipientPrivateKey);
  const recipientPub = x25519.getPublicKey(priv);
  const ephPub = bytes.slice(1, 33);
  const key = deriveKey(x25519.getSharedSecret(priv, ephPub), ephPub, recipientPub);
  const aad = hexToBytes(holder.toLowerCase() as Hex);
  let plain: Uint8Array;
  try {
    plain = chacha20poly1305(key, bytes.slice(33, 45), aad).decrypt(bytes.slice(45));
  } catch {
    throw new EnvelopeError('Envelope failed authentication (wrong key, wrong holder or altered bytes)');
  }
  return JSON.parse(new TextDecoder().decode(plain)) as EnvelopePayload;
}

/** The value bound into the proof. */
export function envelopeHash(envelope: Hex): Hex {
  return keccak256(envelope);
}

export function auditorPublicKeyOf(privateKey: Hex): Hex {
  return bytesToHex(x25519.getPublicKey(hexToBytes(privateKey)));
}
