import type { Asset, Quote, SwapRoute, DexAdapter } from '../dex/types.js';
import BigNumber from 'bignumber.js';

export interface OptimizedQuote {
  totalAmountOut: bigint;
  totalAmountIn: bigint;
  priceImpact: number;
  routes: SwapRoute[];
}

/**
 * Calculate the best split across multiple DEXes for exact input
 */
export async function optimizeExactIn(
  adapters: DexAdapter[],
  assetIn: Asset,
  assetOut: Asset,
  amountIn: bigint
): Promise<OptimizedQuote | null> {
  // Get quotes from all DEXes
  const quotes: (Quote & { adapter: DexAdapter })[] = [];
  
  for (const adapter of adapters) {
    try {
      const quote = await adapter.quoteExactIn(assetIn, assetOut, amountIn);
      quotes.push({ ...quote, adapter });
    } catch (error) {
      console.warn(`Failed to get quote from ${adapter.getName()}:`, error);
      // Continue with other DEXes
    }
  }

  if (quotes.length === 0) {
    return null;
  }

  // If only one quote, use it
  if (quotes.length === 1) {
    const quote = quotes[0];
    return {
      totalAmountOut: quote.amountOut,
      totalAmountIn: amountIn,
      priceImpact: quote.priceImpact,
      routes: [{
        dexName: quote.dexName,
        pool: quote.pool,
        amountIn,
        amountOut: quote.amountOut,
        minimumAmountOut: quote.amountOut, // Will be adjusted with slippage later
      }],
    };
  }

  // Try different split ratios and find the best
  const splitRatios = [
    [1.0, 0.0], // 100% first DEX
    [0.0, 1.0], // 100% second DEX
    [0.5, 0.5], // 50/50
    [0.75, 0.25], // 75/25
    [0.25, 0.75], // 25/75
    [0.6, 0.4], // 60/40
    [0.4, 0.6], // 40/60
  ];

  let bestQuote: OptimizedQuote | null = null;
  let bestTotalOut = 0n;

  for (const [ratio1, ratio2] of splitRatios) {
    if (quotes.length < 2) break;
    
    const amountIn1 = BigInt(Math.floor(Number(amountIn) * ratio1));
    const amountIn2 = amountIn - amountIn1;

    if (amountIn1 === 0n && amountIn2 === 0n) continue;

    const routes: SwapRoute[] = [];
    let totalOut = 0n;
    let totalPriceImpact = 0;
    let valid = true;

    // Get quote for first DEX
    if (amountIn1 > 0n) {
      try {
        const quote1 = await quotes[0].adapter.quoteExactIn(assetIn, assetOut, amountIn1);
        routes.push({
          dexName: quote1.dexName,
          pool: quote1.pool,
          amountIn: amountIn1,
          amountOut: quote1.amountOut,
          minimumAmountOut: quote1.amountOut,
        });
        totalOut += quote1.amountOut;
        totalPriceImpact += quote1.priceImpact * ratio1;
      } catch (error) {
        valid = false;
      }
    }

    // Get quote for second DEX
    if (amountIn2 > 0n && valid) {
      try {
        const quote2 = await quotes[1].adapter.quoteExactIn(assetIn, assetOut, amountIn2);
        routes.push({
          dexName: quote2.dexName,
          pool: quote2.pool,
          amountIn: amountIn2,
          amountOut: quote2.amountOut,
          minimumAmountOut: quote2.amountOut,
        });
        totalOut += quote2.amountOut;
        totalPriceImpact += quote2.priceImpact * ratio2;
      } catch (error) {
        valid = false;
      }
    }

    if (valid && totalOut > bestTotalOut) {
      bestTotalOut = totalOut;
      bestQuote = {
        totalAmountOut: totalOut,
        totalAmountIn: amountIn,
        priceImpact: totalPriceImpact,
        routes,
      };
    }
  }

  // If no split worked better, use the best single DEX quote
  if (!bestQuote || bestQuote.totalAmountOut <= quotes[0].amountOut) {
    const bestSingleQuote = quotes.reduce((best, q) => 
      q.amountOut > best.amountOut ? q : best
    );
    
    return {
      totalAmountOut: bestSingleQuote.amountOut,
      totalAmountIn: amountIn,
      priceImpact: bestSingleQuote.priceImpact,
      routes: [{
        dexName: bestSingleQuote.dexName,
        pool: bestSingleQuote.pool,
        amountIn,
        amountOut: bestSingleQuote.amountOut,
        minimumAmountOut: bestSingleQuote.amountOut,
      }],
    };
  }

  return bestQuote;
}

/**
 * Calculate the best split across multiple DEXes for exact output
 */
export async function optimizeExactOut(
  adapters: DexAdapter[],
  assetIn: Asset,
  assetOut: Asset,
  amountOut: bigint
): Promise<OptimizedQuote | null> {
  // Get quotes from all DEXes
  const quotes: (Quote & { adapter: DexAdapter })[] = [];
  
  for (const adapter of adapters) {
    try {
      const quote = await adapter.quoteExactOut(assetIn, assetOut, amountOut);
      quotes.push({ ...quote, adapter });
    } catch (error) {
      console.warn(`Failed to get quote from ${adapter.getName()}:`, error);
      // Continue with other DEXes
    }
  }

  if (quotes.length === 0) {
    return null;
  }

  // If only one quote, use it
  if (quotes.length === 1) {
    // For exact out, we need to calculate the input needed
    const quote = quotes[0];
    // The quote already has amountOut, but we need to reverse calculate amountIn
    // This is a simplified approach - in practice, we'd need to query with different amounts
    const estimatedAmountIn = await estimateAmountInForExactOut(
      quotes[0].adapter,
      assetIn,
      assetOut,
      amountOut
    );
    
    return {
      totalAmountOut: amountOut,
      totalAmountIn: estimatedAmountIn,
      priceImpact: quote.priceImpact,
      routes: [{
        dexName: quote.dexName,
        pool: quote.pool,
        amountIn: estimatedAmountIn,
        amountOut,
        minimumAmountOut: amountOut,
      }],
    };
  }

  // For exact out with multiple DEXes, we need to find the split that minimizes total input
  // This is more complex - for now, use the DEX that requires least input
  let bestQuote: OptimizedQuote | null = null;
  let bestAmountIn = BigInt(Number.MAX_SAFE_INTEGER);

  for (const quote of quotes) {
    try {
      const estimatedAmountIn = await estimateAmountInForExactOut(
        quote.adapter,
        assetIn,
        assetOut,
        amountOut
      );
      
      if (estimatedAmountIn < bestAmountIn) {
        bestAmountIn = estimatedAmountIn;
        bestQuote = {
          totalAmountOut: amountOut,
          totalAmountIn: estimatedAmountIn,
          priceImpact: quote.priceImpact,
          routes: [{
            dexName: quote.dexName,
            pool: quote.pool,
            amountIn: estimatedAmountIn,
            amountOut,
            minimumAmountOut: amountOut,
          }],
        };
      }
    } catch (error) {
      console.warn(`Failed to estimate input for ${quote.dexName}:`, error);
    }
  }

  return bestQuote;
}

/**
 * Estimate amount in needed for exact amount out
 * Uses binary search to find the right input amount
 */
async function estimateAmountInForExactOut(
  adapter: DexAdapter,
  assetIn: Asset,
  assetOut: Asset,
  targetAmountOut: bigint
): Promise<bigint> {
  // Start with a reasonable guess (1:1 ratio)
  let low = targetAmountOut;
  let high = targetAmountOut * 2n;
  let bestInput = high;

  // Binary search for the right input amount
  for (let i = 0; i < 20; i++) {
    const mid = (low + high) / 2n;
    try {
      const quote = await adapter.quoteExactIn(assetIn, assetOut, mid);
      if (quote.amountOut >= targetAmountOut) {
        bestInput = mid;
        high = mid;
      } else {
        low = mid + 1n;
      }
    } catch (error) {
      // If quote fails, increase the range
      high = high * 2n;
    }
  }

  return bestInput;
}

