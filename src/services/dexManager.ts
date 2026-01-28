import { MinswapAdapter } from '../dex/minswapAdapter.js';
import { SplashAdapter } from '../dex/splashAdapter.js';
import type { DexAdapter } from '../dex/types.js';
import { optimizeExactIn, optimizeExactOut, type OptimizedQuote } from '../router/quoteOptimizer.js';
import type { Asset } from '../dex/types.js';
import { buildSwapTx, type BuildSwapTxOptions, type UTxO } from '../tx/txBuilder.js';
import type { ScriptRequirement } from '../types.js';
import BigNumber from 'bignumber.js';

/**
 * DEX Manager - coordinates multiple DEX adapters
 */
export class DexManager {
  private adapters: DexAdapter[] = [];
  private minswapAdapter: MinswapAdapter;
  private splashAdapter: SplashAdapter;

  constructor() {
    this.minswapAdapter = new MinswapAdapter();
    this.splashAdapter = new SplashAdapter();
    this.adapters = [this.minswapAdapter, this.splashAdapter];
  }

  /**
   * Get all DEX adapters
   */
  getAdapters(): DexAdapter[] {
    return this.adapters;
  }

  /**
   * Get Minswap adapter (for backward compatibility)
   */
  getMinswapAdapter(): MinswapAdapter {
    return this.minswapAdapter;
  }

  /**
   * Get Splash adapter
   */
  getSplashAdapter(): SplashAdapter {
    return this.splashAdapter;
  }

  /**
   * Calculate best amount out for exact amount in
   */
  async calculateAmountOut(
    assetA: Asset,
    assetB: Asset,
    amountIn: bigint
  ): Promise<[bigint, number]> {
    const optimized = await this.getOptimizedExactIn(assetA, assetB, amountIn);
    return [optimized.totalAmountOut, optimized.priceImpact];
  }

  /**
   * Calculate best amount in for exact amount out
   */
  async calculateAmountIn(
    assetA: Asset,
    assetB: Asset,
    amountOut: bigint
  ): Promise<[bigint, number]> {
    const optimized = await this.getOptimizedExactOut(assetA, assetB, amountOut);
    return [optimized.totalAmountIn, optimized.priceImpact];
  }

  /**
   * Get optimized routes for exact in
   */
  async getOptimizedExactIn(
    assetA: Asset,
    assetB: Asset,
    amountIn: bigint
  ): Promise<OptimizedQuote> {
    const optimized = await optimizeExactIn(this.adapters, assetA, assetB, amountIn);

    if (!optimized) {
      throw new Error('No pools found for this asset pair');
    }

    this.logRoutes('quoteExactIn', optimized.routes);
    return optimized;
  }

  /**
   * Get optimized routes for exact out
   */
  async getOptimizedExactOut(
    assetA: Asset,
    assetB: Asset,
    amountOut: bigint
  ): Promise<OptimizedQuote> {
    const optimized = await optimizeExactOut(this.adapters, assetA, assetB, amountOut);

    if (!optimized) {
      throw new Error('No pools found for this asset pair');
    }

    this.logRoutes('quoteExactOut', optimized.routes);
    return optimized;
  }

  /**
   * Get asset price (in ADA)
   */
  async getAssetPrice(asset: Asset): Promise<number> {
    const ada: Asset = { policyId: '', tokenName: '' };
    
    try {
      const [amountOut] = await this.calculateAmountOut(ada, asset, 1_000_000n);
      return 1 / Number(amountOut) * 1_000_000;
    } catch (error) {
      throw new Error(`Failed to get price for asset: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Create swap transaction
   */
  async createSwapTx(
    assetIn: Asset,
    assetOut: Asset,
    amountIn: bigint,
    utxos: UTxO[],
    address: string,
    slippage: BigNumber,
    script?: string | null,
    scriptRequirements?: ScriptRequirement[]
  ): Promise<string> {
    // Get optimized route
    const optimized = await this.getOptimizedExactIn(assetIn, assetOut, amountIn);

    // Apply slippage to routes
    const routesWithSlippage = optimized.routes.map(route => ({
      ...route,
      minimumAmountOut: applySlippage(route.amountOut, slippage, 'down'),
    }));

    // Build transaction
    const options: BuildSwapTxOptions = {
      routes: routesWithSlippage,
      assetIn,
      assetOut,
      amountIn,
      utxos,
      address,
      slippage,
      script,
      scriptRequirements,
    };

    return await buildSwapTx(options);
  }

  private logRoutes(tag: string, routes: { dexName: string; amountIn: bigint; amountOut: bigint }[]): void {
    const routeSummary = routes.map(route => ({
      dex: route.dexName,
      amountIn: route.amountIn.toString(),
      amountOut: route.amountOut.toString(),
    }));
    console.log(`[${tag}] route breakdown`, routeSummary);
  }
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

// Singleton instance
let dexManagerInstance: DexManager | null = null;

/**
 * Get the global DEX manager instance
 */
export function getDexManager(): DexManager {
  if (!dexManagerInstance) {
    dexManagerInstance = new DexManager();
  }
  return dexManagerInstance;
}

