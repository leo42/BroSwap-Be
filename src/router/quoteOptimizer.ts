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
      if (!isPoolNotFoundError(error)) {
        console.warn(`Failed to get quote from ${adapter.getName()}:`, error);
      }
      // Continue with other DEXes
    }
  }

  if (quotes.length === 0) {
    return null;
  }

  const bestSingleQuote = quotes.reduce((best, q) =>
    q.amountOut > best.amountOut ? q : best
  );

  let bestQuote: OptimizedQuote = {
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

  const splitPercents = Array.from({ length: 99 }, (_, i) => i + 1);

  for (let i = 0; i < quotes.length; i++) {
    for (let j = i + 1; j < quotes.length; j++) {
      for (const percent of splitPercents) {
        const amountInA = (amountIn * BigInt(percent)) / 100n;
        const amountInB = amountIn - amountInA;
        if (amountInA === 0n || amountInB === 0n) {
          continue;
        }

        try {
          const quoteA = await quotes[i].adapter.quoteExactIn(assetIn, assetOut, amountInA);
          const quoteB = await quotes[j].adapter.quoteExactIn(assetIn, assetOut, amountInB);
          const totalOut = quoteA.amountOut + quoteB.amountOut;
          const weightA = percent / 100;
          const totalPriceImpact = quoteA.priceImpact * weightA + quoteB.priceImpact * (1 - weightA);

          if (totalOut > bestQuote.totalAmountOut) {
            bestQuote = {
              totalAmountOut: totalOut,
              totalAmountIn: amountIn,
              priceImpact: totalPriceImpact,
              routes: [
                {
                  dexName: quoteA.dexName,
                  pool: quoteA.pool,
                  amountIn: amountInA,
                  amountOut: quoteA.amountOut,
                  minimumAmountOut: quoteA.amountOut,
                },
                {
                  dexName: quoteB.dexName,
                  pool: quoteB.pool,
                  amountIn: amountInB,
                  amountOut: quoteB.amountOut,
                  minimumAmountOut: quoteB.amountOut,
                },
              ],
            };
          }
        } catch (error) {
          continue;
        }
      }
    }
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
      if (!isPoolNotFoundError(error)) {
        console.warn(`Failed to get quote from ${adapter.getName()}:`, error);
      }
      // Continue with other DEXes
    }
  }

  if (quotes.length === 0) {
    return null;
  }

  let bestQuote: OptimizedQuote | null = null;
  let bestAmountIn = BigInt(Number.MAX_SAFE_INTEGER);

  for (const quote of quotes) {
    try {
      const exactOut = await safeQuoteExactOut(quote.adapter, assetIn, assetOut, amountOut);
      if (exactOut.amountOut === amountOut && exactOut.amountIn < bestAmountIn) {
        bestAmountIn = exactOut.amountIn;
        bestQuote = {
          totalAmountOut: amountOut,
          totalAmountIn: exactOut.amountIn,
          priceImpact: exactOut.priceImpact,
          routes: [{
            dexName: exactOut.dexName,
            pool: exactOut.pool,
            amountIn: exactOut.amountIn,
            amountOut,
            minimumAmountOut: amountOut,
          }],
        };
      }
    } catch (error) {
      console.warn(`Failed to quote exact out for ${quote.dexName}:`, error);
    }
  }

  if (!bestQuote) {
    return null;
  }

  const splitPercents = Array.from({ length: 99 }, (_, i) => i + 1);
  for (let i = 0; i < quotes.length; i++) {
    for (let j = i + 1; j < quotes.length; j++) {
      for (const percent of splitPercents) {
        const amountOutA = (amountOut * BigInt(percent)) / 100n;
        const amountOutB = amountOut - amountOutA;
        if (amountOutA === 0n || amountOutB === 0n) {
          continue;
        }
        try {
          const quoteA = await safeQuoteExactOut(quotes[i].adapter, assetIn, assetOut, amountOutA);
          const quoteB = await safeQuoteExactOut(quotes[j].adapter, assetIn, assetOut, amountOutB);
          const totalIn = quoteA.amountIn + quoteB.amountIn;
          const weightA = percent / 100;
          const totalPriceImpact = quoteA.priceImpact * weightA + quoteB.priceImpact * (1 - weightA);

          if (totalIn < bestAmountIn) {
            bestAmountIn = totalIn;
            bestQuote = {
              totalAmountOut: amountOut,
              totalAmountIn: totalIn,
              priceImpact: totalPriceImpact,
              routes: [
                {
                  dexName: quoteA.dexName,
                  pool: quoteA.pool,
                  amountIn: quoteA.amountIn,
                  amountOut: amountOutA,
                  minimumAmountOut: amountOutA,
                },
                {
                  dexName: quoteB.dexName,
                  pool: quoteB.pool,
                  amountIn: quoteB.amountIn,
                  amountOut: amountOutB,
                  minimumAmountOut: amountOutB,
                },
              ],
            };
          }
        } catch (error) {
          continue;
        }
      }
    }
  }

  return bestQuote;
}

async function safeQuoteExactOut(
  adapter: DexAdapter,
  assetIn: Asset,
  assetOut: Asset,
  amountOut: bigint
): Promise<{ amountIn: bigint; amountOut: bigint; priceImpact: number; pool: any; dexName: string }> {
  const quote = await adapter.quoteExactOut(assetIn, assetOut, amountOut);
  const estimatedAmountIn = await estimateAmountInForExactOut(adapter, assetIn, assetOut, amountOut);
  return {
    amountIn: estimatedAmountIn,
    amountOut,
    priceImpact: quote.priceImpact,
    pool: quote.pool,
    dexName: quote.dexName,
  };
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

function isPoolNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return message.includes('pool not found');
}

