import { encodeAbiParameters, keccak256, toBytes, type Address, type Hex } from 'viem';
import { FIELD_MODULUS, RECEIVE_DOMAIN_TAG, TRANSFER_DOMAIN_TAG } from './constants';
import { fieldHex } from './fields';

const TRANSFER_DOMAIN = keccak256(toBytes(TRANSFER_DOMAIN_TAG));
const RECEIVE_DOMAIN = keccak256(toBytes(RECEIVE_DOMAIN_TAG));

const reduce = (h: Hex): Hex => fieldHex(BigInt(h) % FIELD_MODULUS);

/**
 * Binds a proof to one specific transfer and to the audit envelope that travels
 * with it. Mirrors ComplianceGate.transferBinding.
 */
export function transferBinding(p: {
  chainId: number;
  token: Address;
  from: Address;
  to: Address;
  amount: bigint;
  nonce: bigint;
  envelopeHash: Hex;
}): Hex {
  return reduce(
    keccak256(
      encodeAbiParameters(
        [
          { type: 'bytes32' },
          { type: 'uint256' },
          { type: 'address' },
          { type: 'address' },
          { type: 'address' },
          { type: 'uint256' },
          { type: 'uint256' },
          { type: 'bytes32' },
        ],
        [TRANSFER_DOMAIN, BigInt(p.chainId), p.token, p.from, p.to, p.amount, p.nonce, p.envelopeHash],
      ),
    ),
  );
}

/** Binds a receive-eligibility proof to a holder and registry epoch. Mirrors ComplianceGate.receiveBinding. */
export function receiveBinding(p: { chainId: number; gate: Address; holder: Address; epoch: bigint }): Hex {
  return reduce(
    keccak256(
      encodeAbiParameters(
        [{ type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }, { type: 'address' }, { type: 'uint64' }],
        [RECEIVE_DOMAIN, BigInt(p.chainId), p.gate, p.holder, p.epoch],
      ),
    ),
  );
}
