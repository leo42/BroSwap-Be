// Lazy import Lucid Evolution to avoid libsodium initialization issues at module load time
// import { Lucid, Koios, Blockfrost } from "@lucid-evolution/lucid";
import type { Asset, SwapRoute } from '../dex/types.js';
import type { ScriptRequirement } from '../types.js';
import { loadConfig } from '../utils/configLoader.js';
import { buildMinswapSwapExactInOrderOption } from '../dex/minswapDatum.js';
import { encodeSpotOrderDatum, type SpotOrderDatum } from '../dex/splashDatum.js';
import { getSplashOrderConfig } from '../dex/splashOrder.js';
const config = loadConfig();
import BigNumber from 'bignumber.js';
import cbor from 'cbor';

/**
 * UTxO structure compatible with Lucid Evolution
 */
export interface UTxO {
  txHash: string;
  outputIndex: number;
  address: string;
  assets: Record<string, bigint>;
  datum?: string;
  datumHash?: string;
  scriptRef?: string;
}

/**
 * Transaction building options
 */
export interface BuildSwapTxOptions {
  routes: SwapRoute[];
  assetIn: Asset;
  assetOut: Asset;
  amountIn: bigint;
  utxos: UTxO[];
  address: string;
  slippage: BigNumber;
  script?: string | null;
  scriptRequirements?: ScriptRequirement[];
}

/**
 * Notes:
 * - Mixed DEX routes are not supported in a single tx.
 * - Minswap orders are built via @minswap/sdk (Lucid Cardano).
 * - Splash orders require env/config: SPLASH_ORDER_ADDRESS, SPLASH_ORDER_TYPE,
 *   SPLASH_ORDER_BEACON, SPLASH_BATCHER_FEE, SPLASH_DEPOSIT_ADA,
 *   SPLASH_COST_PER_EX_STEP, SPLASH_EXECUTOR_FEE (or config.splash.* equivalents).
 */

/**
 * Build a swap transaction using Lucid Evolution
 * Returns unsigned CBOR hex string
 */
export async function buildSwapTx(options: BuildSwapTxOptions): Promise<string> {
  const { routes, utxos, address, slippage, assetIn, assetOut } = options;

  if (routes.length === 0) {
    throw new Error('No routes provided');
  }

  const dexNames = Array.from(new Set(routes.map(route => route.dexName)));
  const isDev = process.env.NODE_ENV !== 'production';

  let effectiveRoutes = routes;
  if (dexNames.length > 1) {
    const message = `Mixed DEX routes are not supported in a single transaction: ${dexNames.join(', ')}`;
    if (isDev) {
      console.warn(message);
      const primaryDex = dexNames[0];
      effectiveRoutes = routes.filter(route => route.dexName === primaryDex);
      if (effectiveRoutes.length === 0) {
        throw new Error('No routes for primary DEX after filtering');
      }
    } else {
      throw new Error(message);
    }
  }

  const primaryDex = dexNames[0];
  if (primaryDex === 'Minswap') {
    return await buildMinswapSwapTx(effectiveRoutes, utxos, address, slippage, assetIn, assetOut);
  }
  if (primaryDex === 'Splash') {
    return await buildSplashSwapTx(effectiveRoutes, utxos, address, slippage, assetIn, assetOut);
  }

  throw new Error(`Unsupported DEX: ${primaryDex}`);
}

async function buildMinswapSwapTx(
  routes: SwapRoute[],
  utxos: UTxO[],
  address: string,
  slippage: BigNumber,
  assetIn: Asset,
  assetOut: Asset
): Promise<string> {
  const { BlockFrostAPI } = await import('@blockfrost/blockfrost-js');
  const { BlockfrostAdapter, DexV2 } = await import('@minswap/sdk');
  const { Lucid, Blockfrost } = await import('lucid-cardano');

  const provider =
    config.network === 'mainnet'
      ? new Blockfrost('https://cardano-mainnet.blockfrost.io/api/v0', config.blockfrost.projectId)
      : new Blockfrost('https://cardano-preview.blockfrost.io/api/v0', config.blockfrost.projectId);
  const lucid = await Lucid.new(provider, config.network === 'mainnet' ? 'Mainnet' : 'Preview');

  const blockFrost = new BlockFrostAPI({
    projectId: config.blockfrost.projectId,
    network: config.network,
  });
  const adapter = new BlockfrostAdapter({ blockFrost });
  const dex = new DexV2(lucid, adapter);

  const lucidUtxos = toLucidUtxos(utxos);

  const orderOptions = routes.map(route => {
    const minimumAmountOut = applySlippage(route.amountOut, slippage, 'down');
    return buildMinswapSwapExactInOrderOption(
      route,
      assetIn,
      assetOut,
      route.amountIn,
      minimumAmountOut
    );
  });

  const txComplete = await dex.createBulkOrdersTx({
    sender: address,
    orderOptions,
    availableUtxos: lucidUtxos,
  });

  const txCbor = txComplete.toString();
  return normalizeTransactionCbor(txCbor);
}

async function buildSplashSwapTx(
  routes: SwapRoute[],
  utxos: UTxO[],
  address: string,
  slippage: BigNumber,
  assetIn: Asset,
  assetOut: Asset
): Promise<string> {
  const { Lucid, Blockfrost } = await import('lucid-cardano');
  const splashConfig = getSplashOrderConfig();
  if (!splashConfig) {
    const message = 'Splash order config missing; set SPLASH_ORDER_* env/config values';
    if (process.env.NODE_ENV !== 'production') {
      console.warn(message);
    }
    throw new Error(message);
  }

  const provider =
    config.network === 'mainnet'
      ? new Blockfrost('https://cardano-mainnet.blockfrost.io/api/v0', config.blockfrost.projectId)
      : new Blockfrost('https://cardano-preview.blockfrost.io/api/v0', config.blockfrost.projectId);
  const lucid = await Lucid.new(provider, config.network === 'mainnet' ? 'Mainnet' : 'Preview');

  const lucidUtxos = toLucidUtxos(utxos);
  lucid.selectWallet.fromAddress(address, lucidUtxos);

  let tx = lucid.newTx();
  const addressDetails = lucid.utils.getAddressDetails(address);
  if (!addressDetails.paymentCredential) {
    throw new Error('Invalid sender address: missing payment credential');
  }

  for (const route of routes) {
    const poolAssetA = route.pool.assetA;
    const poolAssetB = route.pool.assetB;
    const inputMatches =
      (assetIn.policyId === poolAssetA.policyId && assetIn.tokenName === poolAssetA.tokenName) ||
      (assetIn.policyId === poolAssetB.policyId && assetIn.tokenName === poolAssetB.tokenName);
    const outputMatches =
      (assetOut.policyId === poolAssetA.policyId && assetOut.tokenName === poolAssetA.tokenName) ||
      (assetOut.policyId === poolAssetB.policyId && assetOut.tokenName === poolAssetB.tokenName);
    if (!inputMatches || !outputMatches) {
      throw new Error('assetIn/assetOut do not match Splash pool assets');
    }

    const minimumAmountOut = applySlippage(route.amountOut, slippage, 'down');
    const datum: SpotOrderDatum = {
      type: splashConfig.orderType,
      beacon: splashConfig.beacon,
      inputAsset: {
        policyId: assetIn.policyId,
        name: assetIn.tokenName,
      },
      inputAmount: route.amountIn,
      costPerExStep: splashConfig.costPerExStep,
      minMarginalOutput: minimumAmountOut,
      outputAsset: {
        policyId: assetOut.policyId,
        name: assetOut.tokenName,
      },
      price: {
        numerator: minimumAmountOut,
        denominator: route.amountIn,
      },
      executorFee: splashConfig.executorFee,
      address: {
        paymentCredentials:
          addressDetails.paymentCredential.type === 'Key'
            ? { paymentKeyHash: addressDetails.paymentCredential.hash }
            : { scriptHash: addressDetails.paymentCredential.hash },
        stakeCredentials:
          addressDetails.stakeCredential?.type === 'Key'
            ? { paymentKeyHash: addressDetails.stakeCredential.hash }
            : addressDetails.stakeCredential?.type === 'Script'
              ? { scriptHash: addressDetails.stakeCredential.hash }
              : {},
      },
      cancelPkh:
        addressDetails.paymentCredential.type === 'Key'
          ? addressDetails.paymentCredential.hash
          : '',
      permittedExecutors: [],
    };

    const datumCbor = encodeSpotOrderDatum(datum);
    const assets = buildAssetMap(
      assetIn.policyId,
      assetIn.tokenName,
      route.amountIn
    );
    assets.lovelace =
      (assets.lovelace ?? 0n) +
      splashConfig.depositAda +
      splashConfig.batcherFee +
      splashConfig.executorFee;

    tx = tx.payToContract(splashConfig.orderAddress, { inline: datumCbor }, assets);
  }

  const completedTx = await tx.complete();
  const txCbor = completedTx.toString();
  return normalizeTransactionCbor(txCbor);
}

/**
 * Apply slippage to an amount
 */
function applySlippage(
  amount: bigint,
  slippage: BigNumber,
  type: 'up' | 'down'
): bigint {
  switch (type) {
    case 'up': {
      const slippageAdjustedAmount = new BigNumber(1)
        .plus(slippage)
        .multipliedBy(amount.toString());
      return BigInt(slippageAdjustedAmount.toFixed(0, BigNumber.ROUND_DOWN));
    }
    case 'down': {
      const slippageAdjustedAmount = new BigNumber(1)
        .div(new BigNumber(1).plus(slippage))
        .multipliedBy(amount.toString());
      return BigInt(slippageAdjustedAmount.toFixed(0, BigNumber.ROUND_DOWN));
    }
  }
}

function toLucidUtxos(utxos: UTxO[]): any[] {
  return utxos.map(utxo => ({
    txHash: utxo.txHash,
    outputIndex: utxo.outputIndex,
    address: utxo.address,
    assets: utxo.assets,
    datum: utxo.datum,
    datumHash: utxo.datumHash,
    scriptRef: utxo.scriptRef,
  }));
}

function buildAssetMap(policyId: string, tokenName: string, amount: bigint): Record<string, bigint> {
  if (amount <= 0n) {
    throw new Error('amount must be positive');
  }
  const unit = policyId === '' ? 'lovelace' : `${policyId}${tokenName}`;
  return { [unit]: amount };
}

/**
 * Convert slot number to unix timestamp
 * This is a simplified conversion - actual implementation may vary
 */
function slotToUnixTime(slot: number): number {
  // Cardano mainnet: slot 0 = 2017-09-23 21:44:51 UTC
  // Slot duration: 1 second
  const genesisTime = 1506203091; // Unix timestamp for slot 0
  return genesisTime + slot;
}

/**
 * Normalize transaction CBOR by removing empty multiasset maps (CIP-21 compliance)
 */
function normalizeTransactionCbor(txCborHex: string): string {
  try {
    const cborBuffer = Buffer.from(txCborHex, 'hex');
    const tx = cbor.decodeFirstSync(cborBuffer);
    
    // Normalize the transaction structure
    normalizeValue(tx);
    
    // Re-encode to CBOR
    const normalizedBuffer = cbor.encodeCanonical(tx);
    return normalizedBuffer.toString('hex');
  } catch (error) {
    console.error('Error normalizing transaction CBOR:', error);
    return txCborHex; // Return original if normalization fails
  }
}

/**
 * Recursively normalize a value to remove empty multiasset maps
 */
function normalizeValue(value: any): any {
  if (Array.isArray(value)) {
    return value.map(normalizeValue);
  }
  
  if (value instanceof Map) {
    const normalized = new Map();
    for (const [key, val] of value.entries()) {
      normalized.set(key, normalizeValue(val));
    }
    return normalized;
  }
  
  if (typeof value === 'object' && value !== null) {
    const normalized: any = {};
    for (const [key, val] of Object.entries(value)) {
      normalized[key] = normalizeValue(val);
    }
    
    // Check if this is a value tuple [coin, multiasset] with empty multiasset
    if (Array.isArray(value) && value.length === 2) {
      const [coin, multiasset] = value;
      let isEmpty = false;
      
      if (multiasset === null || multiasset === undefined) {
        isEmpty = true;
      } else if (multiasset instanceof Map) {
        isEmpty = multiasset.size === 0;
      } else if (typeof multiasset === 'object') {
        isEmpty = Object.keys(multiasset).length === 0;
      }
      
      if (isEmpty) {
        return coin;
      }
    }
    
    return normalized;
  }
  
  return value;
}

