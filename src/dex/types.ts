/**
 * Common types for DEX adapters
 */

export interface Asset {
  policyId: string;
  tokenName: string;
}

export interface Pool {
  assetA: Asset;
  assetB: Asset;
  reserveA: bigint;
  reserveB: bigint;
  lpAsset: Asset;
  fee: bigint; // Fee numerator (e.g., 3n for 0.3%)
  feeB?: bigint; // Optional fee numerator for assetB -> assetA swaps
  feeDenominator?: bigint; // Optional fee denominator (default varies by DEX)
  dexName: string;
  poolAddress?: string; // Script address for the pool
  poolUtxo?: string; // UTxO reference
}

export interface Quote {
  amountOut: bigint;
  priceImpact: number;
  pool: Pool;
  dexName: string;
}

export interface SwapRoute {
  dexName: string;
  pool: Pool;
  amountIn: bigint;
  amountOut: bigint;
  minimumAmountOut: bigint;
}

export interface DexAdapter {
  /**
   * Get all available pools for this DEX
   */
  getAllPools(): Promise<Pool[]>;

  /**
   * Find a pool for a given asset pair
   */
  getPoolByPair(assetA: Asset, assetB: Asset): Promise<Pool | null>;

  /**
   * Calculate amount out for exact amount in
   */
  quoteExactIn(assetIn: Asset, assetOut: Asset, amountIn: bigint): Promise<Quote>;

  /**
   * Calculate amount in for exact amount out
   */
  quoteExactOut(assetIn: Asset, assetOut: Asset, amountOut: bigint): Promise<Quote>;

  /**
   * Get the DEX name
   */
  getName(): string;
}

