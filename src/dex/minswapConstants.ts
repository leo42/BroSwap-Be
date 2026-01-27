export interface MinswapV2Config {
  poolScriptAddress: string;
  poolAuthenAsset: string;
  lpPolicyId: string;
}

export const DEFAULT_POOL_ADA = 4_500_000n;
export const TRADING_FEE_DENOMINATOR = 10_000n;

const MAINNET_CONFIG: MinswapV2Config = {
  poolScriptAddress: 'script1agrmwv7exgffcdu27cn5xmnuhsh0p0ukuqpkhdgm800xksw7e2w',
  poolAuthenAsset: 'f5808c2c990d86da54bfc97d89cee6efa20cd8461616359478d96b4c4d5350',
  lpPolicyId: 'f5808c2c990d86da54bfc97d89cee6efa20cd8461616359478d96b4c',
};

const TESTNET_CONFIG: MinswapV2Config = {
  poolScriptAddress: 'script166afkagfatyxv2y075rj62scypdv2mm5f0yzmnvq3ju0uqqmszv',
  poolAuthenAsset: 'd6aae2059baee188f74917493cf7637e679cd219bdfbbf4dcbeb1d0b4d5350',
  lpPolicyId: 'd6aae2059baee188f74917493cf7637e679cd219bdfbbf4dcbeb1d0b',
};

export function getMinswapV2Config(network: string): MinswapV2Config {
  switch (network) {
    case 'mainnet':
      return MAINNET_CONFIG;
    case 'preview':
    case 'preprod':
    case 'sanchonet':
      return TESTNET_CONFIG;
    default:
      return MAINNET_CONFIG;
  }
}

