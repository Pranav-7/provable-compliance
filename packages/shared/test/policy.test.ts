import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POLICY_V12, canonicalPolicy, deriveOnChainParams, formatUnits, policyHash, toBaseUnits } from '../src/index';

test('policy hash is stable regardless of key order', () => {
  const reverseKeys = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(reverseKeys)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverseKeys(x)]))
        : v;
  const shuffled = reverseKeys(POLICY_V12) as typeof POLICY_V12;
  assert.notEqual(JSON.stringify(shuffled), JSON.stringify(POLICY_V12));
  assert.equal(policyHash(shuffled), policyHash(POLICY_V12));
  assert.equal(canonicalPolicy(shuffled), canonicalPolicy(POLICY_V12));
});

test('changing a single rule changes the fingerprint', () => {
  const edited = structuredClone(POLICY_V12);
  const rule = edited.rules.find((r) => r.type === 'CountryAllow');
  if (rule?.type !== 'CountryAllow') throw new Error('missing rule');
  rule.params.countries = ['CH', 'SG'];
  assert.notEqual(policyHash(edited), policyHash(POLICY_V12));
});

test('derives the on-chain parameters the verifier will enforce', () => {
  const p = deriveOnChainParams(POLICY_V12);
  assert.deepEqual(p.allowedCountries, [756, 702, 826, 0]);
  assert.equal(p.allowedClassMask, 0b1100); // professional (bit 2) + institutional (bit 3)
  assert.equal(p.maxHolderBalance, 2_500_000n);
  assert.equal(p.effectiveFrom, 1793491200n);
});

test('rejects invalid policy content', () => {
  const bad = structuredClone(POLICY_V12);
  const rule = bad.rules.find((r) => r.type === 'CountryAllow');
  if (rule?.type !== 'CountryAllow') throw new Error('missing rule');
  rule.params.countries = ['XX'];
  assert.throws(() => deriveOnChainParams(bad), /Unknown jurisdiction/);
});

test('unit conversion round-trips', () => {
  assert.equal(toBaseUnits('25000.00'), 2_500_000n);
  assert.equal(toBaseUnits('1.5'), 150n);
  assert.equal(formatUnits(2_500_050n), '25,000.50');
  assert.throws(() => toBaseUnits('1.234'));
});

test('interbank policy admits licensed banks only', async () => {
  const { POLICY_INTERBANK_V1, INVESTOR_CLASS } = await import('../src/index');
  const p = deriveOnChainParams(POLICY_INTERBANK_V1);
  assert.deepEqual(p.allowedCountries, [756, 392, 702, 826]);
  assert.equal(p.allowedClassMask, 1 << INVESTOR_CLASS.bank);
  assert.equal(p.maxHolderBalance, 1_000_000_000n);
  assert.notEqual(policyHash(POLICY_INTERBANK_V1), policyHash(POLICY_V12));
});
