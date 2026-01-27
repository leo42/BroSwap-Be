import { BlockFrostAPI } from "@blockfrost/blockfrost-js";
import type { Asset, Pool, Quote, DexAdapter } from './types.js';
import { loadConfig } from '../utils/configLoader.js';
const config = loadConfig();

type CardanoNetwork = 'mainnet' | 'preview' | 'preprod' | 'sanchonet';

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
  if (assetId === "lovelace") {
    return { policyId: "", tokenName: "" };
  }
  // Format: policyId + tokenName (hex)
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
interface SplashPoolDatum {
  assetA: string;
  assetB: string;
  reserveA: string;
  reserveB: string;
  fee: string;
  [key: string]: any; // Allow for other fields
}

export class SplashAdapter implements DexAdapter {
  private blockfrost: BlockFrostAPI;
  private allPools: Pool[] = [];
  private lastFetchTime = 0;
  private readonly FETCH_INTERVAL = 60000; // 1 minute
  private readonly poolScriptAddress: string;

  /**
   * @param poolScriptAddress - The script address where Splash pools are located
   *                            This should be provided by the user
   */
  constructor(poolScriptAddress?: string) {
    this.blockfrost = new BlockFrostAPI({
      projectId: config.blockfrost.projectId,
      network: config.network as CardanoNetwork,
    });
    
    // Default Splash pool script address (mainnet)
    // TODO: Replace with actual Splash pool script address
    this.poolScriptAddress = poolScriptAddress || 
      (config.network === 'mainnet' 
        ? 'addr1...' // Placeholder - needs actual address
        : 'addr_test...');
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

    return pool || null;
  }

  async quoteExactIn(assetIn: Asset, assetOut: Asset, amountIn: bigint): Promise<Quote> {
    const pool = await this.getPoolByPair(assetIn, assetOut);
    if (!pool) {
      throw new Error(`Splash pool not found for ${assetToString(assetIn)}/${assetToString(assetOut)}`);
    }

    const assetInId = assetToString(assetIn);
    const assetOutId = assetToString(assetOut);

    const reserveIn = assetInId === assetToString(pool.assetA) ? pool.reserveA : pool.reserveB;
    const reserveOut = assetOutId === assetToString(pool.assetB) ? pool.reserveB : pool.reserveA;

    const amountOut = calculateAmountOut(
      reserveIn,
      reserveOut,
      amountIn,
      pool.fee,
      1000n // fee denominator
    );

    // Calculate price impact
    const spotPrice = Number(reserveOut) / Number(reserveIn);
    const executionPrice = Number(amountOut) / Number(amountIn);
    const priceImpact = Math.abs((spotPrice - executionPrice) / spotPrice) * 100;

    return {
      amountOut,
      priceImpact,
      pool,
      dexName: 'Splash',
    };
  }

  async quoteExactOut(assetIn: Asset, assetOut: Asset, amountOut: bigint): Promise<Quote> {
    const pool = await this.getPoolByPair(assetIn, assetOut);
    if (!pool) {
      throw new Error(`Splash pool not found for ${assetIn.policyId}/${assetOut.policyId}`);
    }

    const assetInId = assetToString(assetIn);
    const assetOutId = assetToString(assetOut);

    const reserveIn = assetInId === assetToString(pool.assetA) ? pool.reserveA : pool.reserveB;
    const reserveOut = assetOutId === assetToString(pool.assetB) ? pool.reserveB : pool.reserveA;

    const amountIn = calculateAmountIn(
      reserveIn,
      reserveOut,
      amountOut,
      pool.fee,
      1000n // fee denominator
    );

    // Calculate price impact
    const spotPrice = Number(reserveOut) / Number(reserveIn);
    const executionPrice = Number(amountOut) / Number(amountIn);
    const priceImpact = Math.abs((spotPrice - executionPrice) / spotPrice) * 100;

    return {
      amountOut: BigInt(amountOut),
      priceImpact,
      pool,
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
      // TODO: Implement actual Splash pool discovery
      // This would involve:
      // 1. Querying UTxOs at the pool script address
      // 2. Decoding the datum from each UTxO
      // 3. Parsing the pool state (reserves, assets, fees)
      // 4. Converting to our Pool format

      // For now, return empty array - pools will be added when actual implementation is provided
      console.log('Splash pool fetching not yet implemented - using empty pool list');
      this.allPools = [];
      this.lastFetchTime = currentTime;
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

  /**
   * Set the pool script address
   */
  setPoolScriptAddress(address: string): void {
    (this as any).poolScriptAddress = address;
  }
}

