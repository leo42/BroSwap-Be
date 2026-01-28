import { BlockFrostAPI } from '@blockfrost/blockfrost-js';
import { createHash } from 'crypto';
import { Data } from 'lucid-cardano';
import type { Asset, Pool, Quote, DexAdapter } from './types.js';
import { loadConfig } from '../utils/configLoader.js';
import { getMinswapV2Config, TRADING_FEE_DENOMINATOR } from './minswapConstants.js';
const config = loadConfig();

type CardanoNetwork = 'mainnet' | 'preview' | 'preprod' | 'sanchonet';

type PlutusConstr = {
  index: number;
  fields: unknown[];
};

interface PoolDatum {
  assetA: Asset;
  assetB: Asset;
  reserveA: bigint;
  reserveB: bigint;
  feeANumerator: bigint;
  feeBNumerator: bigint;
}

function isConstr(value: unknown): value is PlutusConstr {
  return (
    typeof value === 'object' &&
    value !== null &&
    'index' in value &&
    'fields' in value &&
    Array.isArray((value as PlutusConstr).fields)
  );
}

function toHexString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString('hex');
  }
  return String(value);
}

function toBigInt(value: unknown, fieldName: string): bigint {
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'number') {
    return BigInt(value);
  }
  if (typeof value === 'string') {
    return BigInt(value);
  }
  throw new Error(`Unsupported ${fieldName} type: ${typeof value}`);
}

function sha3Hex(hex: string): string {
  return createHash('sha3-256').update(Buffer.from(hex, 'hex')).digest('hex');
}

function assetToString(asset: Asset): string {
  return asset.policyId === '' ? 'lovelace' : asset.policyId + asset.tokenName;
}

function assetFromString(assetId: string): Asset {
  if (assetId === 'lovelace') {
    return { policyId: '', tokenName: '' };
  }
  if (assetId.length > 56) {
    return {
      policyId: assetId.slice(0, 56),
      tokenName: assetId.slice(56),
    };
  }
  return { policyId: assetId, tokenName: '' };
}

function parseAsset(data: unknown): Asset {
  if (!isConstr(data) || data.index !== 0) {
    throw new Error('Invalid asset datum');
  }
  const policyId = toHexString(data.fields[0]);
  const tokenName = toHexString(data.fields[1]);
  return { policyId, tokenName };
}

function computeLpAssetName(assetA: Asset, assetB: Asset): string {
  const k1 = sha3Hex(assetA.policyId + assetA.tokenName);
  const k2 = sha3Hex(assetB.policyId + assetB.tokenName);
  return sha3Hex(k1 + k2);
}

function parsePoolDatum(datumCbor: string): PoolDatum {
  const data = Data.from(datumCbor);
  if (!isConstr(data) || data.index !== 0) {
    throw new Error('Invalid pool datum index');
  }

  const assetA = parseAsset(data.fields[1]);
  const assetB = parseAsset(data.fields[2]);
  const reserveA = toBigInt(data.fields[4], 'reserveA');
  const reserveB = toBigInt(data.fields[5], 'reserveB');
  const feeANumerator = toBigInt(data.fields[6], 'feeANumerator');
  const feeBNumerator = toBigInt(data.fields[7], 'feeBNumerator');

  return {
    assetA,
    assetB,
    reserveA,
    reserveB,
    feeANumerator,
    feeBNumerator,
  };
}

function calculateAmountOut(
  reserveIn: bigint,
  reserveOut: bigint,
  amountIn: bigint,
  feeNumerator: bigint,
  feeDenominator: bigint
): bigint {
  const amountInWithFee = amountIn * (feeDenominator - feeNumerator);
  const numerator = amountInWithFee * reserveOut;
  const denominator = (reserveIn * feeDenominator) + amountInWithFee;
  return numerator / denominator;
}

function calculateAmountIn(
  reserveIn: bigint,
  reserveOut: bigint,
  amountOut: bigint,
  feeNumerator: bigint,
  feeDenominator: bigint
): bigint {
  if (reserveOut <= amountOut) {
    throw new Error('Insufficient liquidity');
  }
  const numerator = reserveIn * amountOut * feeDenominator;
  const denominator = (reserveOut - amountOut) * (feeDenominator - feeNumerator);
  return (numerator / denominator) + 1n;
}

export class MinswapAdapter implements DexAdapter {
  private blockfrost: BlockFrostAPI;
  private allPools: Pool[] = [];
  private lastFetchTime = 0;
  private readonly FETCH_INTERVAL = 60000;
  private readonly poolScriptAddress: string;
  private readonly poolAuthenAsset: string;
  private readonly lpPolicyId: string;

  constructor() {
    const blockFrostAPI = new BlockFrostAPI({
      projectId: config.blockfrost.projectId,
      network: config.network as CardanoNetwork,
    });
    this.blockfrost = blockFrostAPI;

    const v2Config = getMinswapV2Config(config.network);
    this.poolScriptAddress = v2Config.poolScriptAddress;
    this.poolAuthenAsset = v2Config.poolAuthenAsset;
    this.lpPolicyId = v2Config.lpPolicyId;
  }

  getName(): string {
    return 'Minswap';
  }

  async getAllPools(): Promise<Pool[]> {
    await this.fetchAllPools();
    return this.allPools;
  }

  async getPoolByPair(assetA: Asset, assetB: Asset): Promise<Pool | null> {
    await this.fetchAllPools();

    const assetAId = assetToString(assetA);
    const assetBId = assetToString(assetB);

    const pool = this.allPools.find(p => {
      const pAssetA = assetToString(p.assetA);
      const pAssetB = assetToString(p.assetB);
      return (pAssetA === assetAId && pAssetB === assetBId) ||
        (pAssetA === assetBId && pAssetB === assetAId);
    });

    return pool || null;
  }

  async quoteExactIn(assetIn: Asset, assetOut: Asset, amountIn: bigint): Promise<Quote> {
    const pools = await this.getPoolsByPair(assetIn, assetOut);
    if (pools.length === 0) {
      throw new Error(`Pool not found for ${assetToString(assetIn)}/${assetToString(assetOut)}`);
    }

    const assetInId = assetToString(assetIn);
    let bestQuote: Quote | null = null;

    for (const pool of pools) {
      const reserveIn = assetInId === assetToString(pool.assetA) ? pool.reserveA : pool.reserveB;
      const reserveOut = assetInId === assetToString(pool.assetA) ? pool.reserveB : pool.reserveA;
      const feeNumerator = assetInId === assetToString(pool.assetA) ? pool.fee : (pool.feeB ?? pool.fee);

      const amountOut = calculateAmountOut(
        reserveIn,
        reserveOut,
        amountIn,
        feeNumerator,
        TRADING_FEE_DENOMINATOR
      );

      const spotPrice = Number(reserveOut) / Number(reserveIn);
      const executionPrice = Number(amountOut) / Number(amountIn);
      const priceImpact = Math.abs((spotPrice - executionPrice) / spotPrice) * 100;

      if (!bestQuote || amountOut > bestQuote.amountOut) {
        bestQuote = {
          amountOut,
          priceImpact,
          pool,
          dexName: 'Minswap',
        };
      }
    }

    if (!bestQuote) {
      throw new Error(`Pool not found for ${assetToString(assetIn)}/${assetToString(assetOut)}`);
    }

    return bestQuote;
  }

  async quoteExactOut(assetIn: Asset, assetOut: Asset, amountOut: bigint): Promise<Quote> {
    const pools = await this.getPoolsByPair(assetIn, assetOut);
    if (pools.length === 0) {
      throw new Error(`Pool not found for ${assetToString(assetIn)}/${assetToString(assetOut)}`);
    }

    const assetInId = assetToString(assetIn);
    let bestQuote: Quote | null = null;
    let bestAmountIn: bigint | null = null;

    for (const pool of pools) {
      const reserveIn = assetInId === assetToString(pool.assetA) ? pool.reserveA : pool.reserveB;
      const reserveOut = assetInId === assetToString(pool.assetA) ? pool.reserveB : pool.reserveA;
      const feeNumerator = assetInId === assetToString(pool.assetA) ? pool.fee : (pool.feeB ?? pool.fee);

      try {
        const amountIn = calculateAmountIn(
          reserveIn,
          reserveOut,
          amountOut,
          feeNumerator,
          TRADING_FEE_DENOMINATOR
        );

        const spotPrice = Number(reserveOut) / Number(reserveIn);
        const executionPrice = Number(amountOut) / Number(amountIn);
        const priceImpact = Math.abs((spotPrice - executionPrice) / spotPrice) * 100;

        if (bestAmountIn === null || amountIn < bestAmountIn) {
          bestAmountIn = amountIn;
          bestQuote = {
            amountOut,
            priceImpact,
            pool,
            dexName: 'Minswap',
          };
        }
      } catch (error) {
        continue;
      }
    }

    if (!bestQuote) {
      throw new Error(`Pool not found for ${assetToString(assetIn)}/${assetToString(assetOut)}`);
    }

    return bestQuote;
  }

  private async fetchAllPools(): Promise<void> {
    const currentTime = Date.now();
    if (currentTime - this.lastFetchTime < this.FETCH_INTERVAL) {
      return;
    }

    try {
      const utxos = await this.blockfrost.addressesUtxosAssetAll(
        this.poolScriptAddress,
        this.poolAuthenAsset
      );
      const pools: Pool[] = [];
      const errors: Error[] = [];

      for (const utxo of utxos) {
        try {
          const datumCbor = await this.resolveDatumCbor(utxo);
          const datum = parsePoolDatum(datumCbor);
          const lpAssetName = computeLpAssetName(datum.assetA, datum.assetB);

          pools.push({
            assetA: datum.assetA,
            assetB: datum.assetB,
            reserveA: datum.reserveA,
            reserveB: datum.reserveB,
            lpAsset: { policyId: this.lpPolicyId, tokenName: lpAssetName },
            fee: datum.feeANumerator,
            feeB: datum.feeBNumerator,
            dexName: 'Minswap',
            poolAddress: utxo.address,
            poolUtxo: `${utxo.tx_hash}#${utxo.output_index}`,
          });
        } catch (error) {
          errors.push(error instanceof Error ? error : new Error(String(error)));
        }
      }

      if (errors.length > 0) {
        console.error('Errors while fetching Minswap pools:', errors);
      }

      this.allPools = pools;
      this.lastFetchTime = currentTime;
      console.log(`Fetched ${pools.length} Minswap pools at ${new Date().toISOString()}`);
    } catch (error) {
      console.error('Error fetching Minswap pools:', error);
      throw error;
    }
  }

  private async resolveDatumCbor(utxo: any): Promise<string> {
    if (utxo.inline_datum) {
      return utxo.inline_datum;
    }
    if (!utxo.data_hash) {
      throw new Error(`Cannot find datum of Minswap pool: ${utxo.tx_hash}`);
    }
    const scriptsDatum = await this.blockfrost.scriptsDatumCbor(utxo.data_hash);
    return scriptsDatum.cbor;
  }

  private async getPoolsByPair(assetA: Asset, assetB: Asset): Promise<Pool[]> {
    await this.fetchAllPools();

    const assetAId = assetToString(assetA);
    const assetBId = assetToString(assetB);

    return this.allPools.filter(p => {
      const pAssetA = assetToString(p.assetA);
      const pAssetB = assetToString(p.assetB);
      return (pAssetA === assetAId && pAssetB === assetBId) ||
        (pAssetA === assetBId && pAssetB === assetAId);
    });
  }
}

