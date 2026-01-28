import type { Asset, SwapRoute } from './types.js';
import { OrderV2, type OrderOptions, type Asset as MinswapAsset } from '@minswap/sdk';

function isHex(value: string): boolean {
  return /^[0-9a-fA-F]*$/.test(value);
}

function assertAsset(asset: Asset, label: string): void {
  if (!isHex(asset.policyId)) {
    throw new Error(`${label} policyId must be hex`);
  }
  if (!isHex(asset.tokenName)) {
    throw new Error(`${label} tokenName must be hex`);
  }
  if (asset.policyId.length !== 0 && asset.policyId.length !== 56) {
    throw new Error(`${label} policyId must be 28 bytes hex`);
  }
  if (asset.tokenName.length % 2 !== 0) {
    throw new Error(`${label} tokenName must be even-length hex`);
  }
}

function toMinswapAsset(asset: Asset): MinswapAsset {
  return { policyId: asset.policyId, tokenName: asset.tokenName };
}

export function buildMinswapSwapExactInOrderOption(
  route: SwapRoute,
  assetIn: Asset,
  assetOut: Asset,
  amountIn: bigint,
  minimumAmountOut: bigint
): OrderOptions {
  if (amountIn <= 0n) {
    throw new Error('amountIn must be positive');
  }
  if (minimumAmountOut <= 0n) {
    throw new Error('minimumAmountOut must be positive');
  }

  assertAsset(assetIn, 'assetIn');
  assertAsset(assetOut, 'assetOut');
  assertAsset(route.pool.lpAsset, 'lpAsset');

  const poolAssetA = route.pool.assetA;
  const poolAssetB = route.pool.assetB;
  const matchesA =
    assetIn.policyId === poolAssetA.policyId && assetIn.tokenName === poolAssetA.tokenName;
  const matchesB =
    assetIn.policyId === poolAssetB.policyId && assetIn.tokenName === poolAssetB.tokenName;
  if (!matchesA && !matchesB) {
    throw new Error('assetIn does not match pool assets');
  }

  const direction = matchesA ? OrderV2.Direction.A_TO_B : OrderV2.Direction.B_TO_A;

  return {
    type: OrderV2.StepType.SWAP_EXACT_IN,
    assetIn: toMinswapAsset(assetIn),
    amountIn,
    minimumAmountOut,
    direction,
    killOnFailed: true,
    isLimitOrder: false,
    lpAsset: toMinswapAsset(route.pool.lpAsset),
  };
}

