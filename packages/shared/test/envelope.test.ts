import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUDITOR_PUBLIC_KEY, EnvelopeError, auditorPublicKeyOf, decryptEnvelope, encryptEnvelope, envelopeHash, type EnvelopePayload } from '../src/index';

const AUDITOR_KEY = '0x8f46a2230a493a78a55b95a6efd2165d89a24aabad224e025fcd32e9db11d6b3' as const;
const HOLDER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const;

const payload: EnvelopePayload = {
  v: 1,
  caseId: 'client',
  holder: HOLDER,
  country: 756,
  investorClass: 2,
  expiry: '1830000000',
  salt: '12345',
  leafIndex: 0,
  path: ['1', '2'],
  proofRoot: '0x01',
  policyVersion: 12,
  to: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
  amount: '10000',
  nonce: '0',
};

test('the published auditor key matches the development private key', () => {
  assert.equal(auditorPublicKeyOf(AUDITOR_KEY), AUDITOR_PUBLIC_KEY);
});

test('only the auditor can open an envelope, and only for the right holder', () => {
  const env = encryptEnvelope(payload);
  assert.deepEqual(decryptEnvelope(env, AUDITOR_KEY, HOLDER), payload);
  assert.throws(() => decryptEnvelope(env, `0x${'11'.repeat(32)}`, HOLDER), EnvelopeError);
  assert.throws(() => decryptEnvelope(env, AUDITOR_KEY, '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'), EnvelopeError);
});

test('any altered byte fails authentication and changes the bound hash', () => {
  const env = encryptEnvelope(payload);
  const altered = (env.slice(0, -2) + (env.endsWith('00') ? '01' : '00')) as `0x${string}`;
  assert.throws(() => decryptEnvelope(altered, AUDITOR_KEY, HOLDER), EnvelopeError);
  assert.notEqual(envelopeHash(env), envelopeHash(altered));
});

test('two envelopes of the same data are unlinkable', () => {
  assert.notEqual(encryptEnvelope(payload), encryptEnvelope(payload));
});
