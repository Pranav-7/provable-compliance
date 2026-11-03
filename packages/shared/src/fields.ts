import { pad, toHex, type Hex } from 'viem';
import { FIELD_MODULUS } from './constants';

/** Reduces any non-negative integer into the BN254 scalar field. */
export function toField(value: bigint | number | Hex): bigint {
  const v = typeof value === 'string' ? BigInt(value) : BigInt(value);
  if (v < 0n) throw new Error('Field elements must be non-negative');
  return v % FIELD_MODULUS;
}

/** 32-byte, 0x-prefixed big-endian representation (the form Noir and Solidity both accept). */
export function fieldHex(value: bigint): Hex {
  return pad(toHex(value), { size: 32 });
}

export function fieldToBytes(value: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let v = value;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

export function bytesToField(bytes: Uint8Array): bigint {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

export function randomField(): bigint {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToField(bytes) % FIELD_MODULUS;
}
