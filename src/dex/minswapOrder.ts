import { DexV2Constant, NetworkId } from '@minswap/sdk';

export interface MinswapOrderConfig {
  orderAddress: string;
  orderScriptHash: string;
  poolScriptHash: string;
  factoryAddress: string;
  poolBatchingAddress: string;
  expiredOrderCancelAddress: string;
}

function networkToId(network: string): NetworkId {
  switch (network) {
    case 'mainnet':
      return NetworkId.MAINNET;
    case 'preview':
    case 'preprod':
    case 'sanchonet':
    default:
      return NetworkId.TESTNET;
  }
}

export function getMinswapOrderConfig(network: string): MinswapOrderConfig {
  const config = DexV2Constant.CONFIG[networkToId(network)];

  return {
    orderAddress: config.orderEnterpriseAddress,
    orderScriptHash: config.orderScriptHash,
    poolScriptHash: config.poolScriptHash,
    factoryAddress: config.factoryAddress,
    poolBatchingAddress: config.poolBatchingAddress,
    expiredOrderCancelAddress: config.expiredOrderCancelAddress,
  };
}

