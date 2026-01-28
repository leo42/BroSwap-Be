import type { Asset, Pool, Quote, DexAdapter } from './types.js';
import { loadConfig } from '../utils/configLoader.js';
import { getSplashApiConfig } from './splashConstants.js';
const config = loadConfig();

/**
 * Constant Product AMM calculation (x * y = k)
 * Similar to Uniswap V2
 */
function calculateAmountOut(
  reserveIn: bigint,
  reserveOut: bigint,
  amountIn: bigint,
  feeNumerator: bigint = 3n, // 0.3% default fee
  feeDenominator: bigint = 1000n
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
  feeNumerator: bigint = 3n, // 0.3% default fee
  feeDenominator: bigint = 1000n
): bigint {
  if (reserveOut <= amountOut) {
    throw new Error("Insufficient liquidity");
  }
  const numerator = reserveIn * amountOut * feeDenominator;
  const denominator = (reserveOut - amountOut) * (feeDenominator - feeNumerator);
  return (numerator / denominator) + 1n; // +1 for rounding up
}

/**
 * Convert asset to string ID (lovelace for ADA)
 */
function assetToString(asset: Asset): string {
  return asset.policyId === "" ? "lovelace" : asset.policyId + asset.tokenName;
}

/**
 * Parse asset from string ID
 */
function assetFromString(assetId: string): Asset {
  if (assetId === "lovelace" || assetId === ".") {
    return { policyId: "", tokenName: "" };
  }
  // Splash API format: policyId.tokenName (tokenName may be empty)
  if (assetId.includes(".")) {
    const [policyId, tokenName = ""] = assetId.split(".", 2);
    return { policyId, tokenName };
  }
  // Fallback format: policyId + tokenName (hex)
  if (assetId.length > 56) {
    return {
      policyId: assetId.slice(0, 56),
      tokenName: assetId.slice(56),
    };
  }
  return { policyId: assetId, tokenName: "" };
}

/**
 * Splash pool datum structure (placeholder - needs to be updated with actual schema)
 */
type RawSplashPoolVersion = 'v1' | 'v2' | 'v3' | 'v4' | 'v5' | 'v6';

interface CurrencyDescriptor {
  amount: string;
  asset: string;
}

interface RawSplashPoolInfo {
  id: string;
  x: CurrencyDescriptor;
  y: CurrencyDescriptor;
  lq: CurrencyDescriptor;
  poolFeeNumX: string | number;
  poolFeeNumY: string | number;
  treasuryFee: string | number;
  treasuryX: string | number;
  treasuryY: string | number;
  royaltyX?: string | number;
  royaltyY?: string | number;
  outputId: {
    transactionId: string;
    transactionIndex: number;
  };
  poolType: 'cfmm' | 'stable' | 'weighted';
  version?: RawSplashPoolVersion;
}

interface RawSplashPool {
  pool: RawSplashPoolInfo;
}

function feeDenominatorForVersion(version?: RawSplashPoolVersion): bigint {
  switch (version) {
    case 'v3':
    case 'v4':
    case 'v5':
    case 'v6':
      return 100000n;
    default:
      return 1000n;
  }
}

export class SplashAdapter implements DexAdapter {
  private allPools: Pool[] = [];
  private lastFetchTime = 0;
  private readonly FETCH_INTERVAL = 60000; // 1 minute

  /**
   * @param apiBaseUrl - Optional base URL for the Splash API (defaults to network config)
   */
  constructor(private apiBaseUrl?: string) {
    const apiConfig = getSplashApiConfig(config.network);
    this.apiBaseUrl = apiBaseUrl || apiConfig.baseUrl;
  }

  getName(): string {
    return 'Splash';
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

    if (!pool) {
      console.warn(
        `Splash pool not found for ${assetAId}/${assetBId} (total pools: ${this.allPools.length})`
      );
      return null;
    }
    return pool;
  }

  async quoteExactIn(assetIn: Asset, assetOut: Asset, amountIn: bigint): Promise<Quote> {
    const pools = await this.getPoolsByPair(assetIn, assetOut);
    if (pools.length === 0) {
      throw new Error(`Splash pool not found for ${assetToString(assetIn)}/${assetToString(assetOut)}`);
    }

    const assetInId = assetToString(assetIn);
    let bestQuote: Quote | null = null;

    for (const pool of pools) {
      const reserveIn = assetInId === assetToString(pool.assetA) ? pool.reserveA : pool.reserveB;
      const reserveOut = assetInId === assetToString(pool.assetA) ? pool.reserveB : pool.reserveA;
      const feeNumerator = assetInId === assetToString(pool.assetA) ? pool.fee : (pool.feeB ?? pool.fee);
      const feeDenominator = pool.feeDenominator ?? 1000n;

      const amountOut = calculateAmountOut(
        reserveIn,
        reserveOut,
        amountIn,
        feeNumerator,
        feeDenominator
      );

      const spotPrice = Number(reserveOut) / Number(reserveIn);
      const executionPrice = Number(amountOut) / Number(amountIn);
      const priceImpact = Math.abs((spotPrice - executionPrice) / spotPrice) * 100;

      if (!bestQuote || amountOut > bestQuote.amountOut) {
        bestQuote = {
          amountOut,
          priceImpact,
          pool,
          dexName: 'Splash',
        };
      }
    }

    if (!bestQuote) {
      throw new Error(`Splash pool not found for ${assetToString(assetIn)}/${assetToString(assetOut)}`);
    }

    return bestQuote;
  }

  async quoteExactOut(assetIn: Asset, assetOut: Asset, amountOut: bigint): Promise<Quote> {
    const pools = await this.getPoolsByPair(assetIn, assetOut);
    if (pools.length === 0) {
      throw new Error(`Splash pool not found for ${assetIn.policyId}/${assetOut.policyId}`);
    }

    const assetInId = assetToString(assetIn);
    let bestQuote: Quote | null = null;
    let bestAmountIn: bigint | null = null;

    for (const pool of pools) {
      const reserveIn = assetInId === assetToString(pool.assetA) ? pool.reserveA : pool.reserveB;
      const reserveOut = assetInId === assetToString(pool.assetA) ? pool.reserveB : pool.reserveA;
      const feeNumerator = assetInId === assetToString(pool.assetA) ? pool.fee : (pool.feeB ?? pool.fee);
      const feeDenominator = pool.feeDenominator ?? 1000n;

      try {
        const amountIn = calculateAmountIn(
          reserveIn,
          reserveOut,
          amountOut,
          feeNumerator,
          feeDenominator
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
            dexName: 'Splash',
          };
        }
      } catch (error) {
        continue;
      }
    }

    if (!bestQuote) {
      throw new Error(`Splash pool not found for ${assetIn.policyId}/${assetOut.policyId}`);
    }

    return {
      amountOut: BigInt(amountOut),
      priceImpact: bestQuote.priceImpact,
      pool: bestQuote.pool,
      dexName: 'Splash',
    };
  }

  /**
   * Fetch all Splash pools from the script address
   * This is a placeholder implementation - needs actual Splash pool discovery logic
   */
  private async fetchAllPools(): Promise<void> {
    const currentTime = Date.now();
    if (currentTime - this.lastFetchTime < this.FETCH_INTERVAL) {
      return;
    }

    try {
      const response = await fetch(
        `${this.apiBaseUrl}pools/overview?verified=false&duplicated=true`
      );
      if (!response.ok) {
        throw new Error(`Splash API error ${response.status}`);
      }
      const rawPools: RawSplashPool[] = await response.json();
      const pools: Pool[] = [];

      for (const rawPool of rawPools) {
        const mapped = mapRawPoolToPool(rawPool);
        if (mapped) {
          pools.push(mapped);
        }
      }

      this.allPools = pools;
      this.lastFetchTime = currentTime;
      console.log(`Fetched ${pools.length} Splash pools at ${new Date().toISOString()}`);
    } catch (error) {
      console.error('Error fetching Splash pools:', error);
      // Don't throw - allow other DEXes to work even if Splash fails
      this.allPools = [];
    }
  }

  /**
   * Manually add a pool (useful for testing or if discovery is not yet implemented)
   */
  addPool(pool: Pool): void {
    const exists = this.allPools.some(p => 
      assetToString(p.assetA) === assetToString(pool.assetA) &&
      assetToString(p.assetB) === assetToString(pool.assetB)
    );
    if (!exists) {
      this.allPools.push(pool);
    }
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

function mapRawPoolToPool(rawPool: RawSplashPool): Pool | null {
  if (rawPool.pool.poolType !== 'cfmm') {
    return null;
  }

  const feeDenominator = feeDenominatorForVersion(rawPool.pool.version);
  const poolFeeX = BigInt(rawPool.pool.poolFeeNumX);
  const poolFeeY = BigInt(rawPool.pool.poolFeeNumY);
  const feeA = poolFeeX > feeDenominator ? poolFeeX : (feeDenominator - poolFeeX);
  const feeB = poolFeeY > feeDenominator ? poolFeeY : (feeDenominator - poolFeeY);
  const assetA = assetFromString(rawPool.pool.x.asset);
  const assetB = assetFromString(rawPool.pool.y.asset);
  const treasuryA = rawPool.pool.treasuryX ? BigInt(rawPool.pool.treasuryX) : 0n;
  const treasuryB = rawPool.pool.treasuryY ? BigInt(rawPool.pool.treasuryY) : 0n;
  const royaltyA = rawPool.pool.royaltyX ? BigInt(rawPool.pool.royaltyX) : 0n;
  const royaltyB = rawPool.pool.royaltyY ? BigInt(rawPool.pool.royaltyY) : 0n;
  const totalA = BigInt(rawPool.pool.x.amount);
  const totalB = BigInt(rawPool.pool.y.amount);
  const reserveA = totalA - treasuryA - royaltyA;
  const reserveB = totalB - treasuryB - royaltyB;
  const lpAsset = assetFromString(rawPool.pool.lq.asset);

  return {
    assetA,
    assetB,
    reserveA,
    reserveB,
    lpAsset,
    fee: feeA,
    feeB: feeB,
    feeDenominator,
    dexName: 'Splash',
    poolUtxo: `${rawPool.pool.outputId.transactionId}#${rawPool.pool.outputId.transactionIndex}`,
  };
}

