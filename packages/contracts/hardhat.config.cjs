/**
 * Local development chain only. Contracts are compiled with solc-js
 * (scripts/compile.mjs), so Hardhat is used purely as the JSON-RPC node.
 */
module.exports = {
  solidity: '0.8.28',
  networks: {
    hardhat: {
      chainId: 31337,
      // The generated UltraHonk verifier is large; production deployments split it
      // into linked libraries (as we do) but a local node should never refuse it.
      allowUnlimitedContractSize: true,
      // Mine failed transactions instead of rejecting them at the RPC layer, so
      // contract-level rejections are visible on-chain and in the audit trail.
      throwOnTransactionFailures: false,
      blockGasLimit: 60_000_000,
      mining: { auto: true },
      accounts: { mnemonic: 'test test test test test test test test test test test junk', count: 10 },
    },
  },
};
