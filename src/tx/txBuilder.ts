// Lazy import Lucid Evolution to avoid libsodium initialization issues at module load time
// import { Lucid, Koios, Blockfrost } from "@lucid-evolution/lucid";
import type { Asset, SwapRoute } from '../dex/types.js';
import type { ScriptRequirement } from '../types.js';
import { loadConfig } from '../utils/configLoader.js';
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
 * Build a swap transaction using Lucid Evolution
 * Returns unsigned CBOR hex string
 */
export async function buildSwapTx(options: BuildSwapTxOptions): Promise<string> {
  const { routes, utxos, address, slippage, script, scriptRequirements } = options;

  // Lazy import Lucid Evolution to avoid libsodium initialization at module load time
  const { Lucid, Blockfrost } = await import("@lucid-evolution/lucid");

  // Initialize Lucid Evolution with provider
  const provider = config.network === 'mainnet'
    ? new Blockfrost("https://cardano-mainnet.blockfrost.io/api/v0", config.blockfrost.projectId)
    : new Blockfrost("https://cardano-preview.blockfrost.io/api/v0", config.blockfrost.projectId);

  const lucid = await Lucid(provider, config.network === 'mainnet' ? 'Mainnet' : 'Preview');

  // Start building transaction
  let tx = lucid.newTx();

  // Convert UTxOs to Lucid Evolution format
  const lucidUtxos = utxos.map(utxo => ({
    txHash: utxo.txHash,
    outputIndex: utxo.outputIndex,
    address: utxo.address,
    assets: utxo.assets,
    datum: utxo.datum,
    datumHash: utxo.datumHash,
    scriptRef: utxo.scriptRef,
  })) as any; // Type assertion - Lucid Evolution UTxO type may differ

  // Select wallet from UTxOs
  lucid.selectWallet.fromAddress(address, lucidUtxos);

  // Build swap transactions for each route
  // For now, we'll build a single transaction that handles all routes
  // This is a simplified approach - in practice, you might need separate transactions
  // or a more complex composition depending on the DEX requirements

  // If we have routes, build them
  // Note: Actual DEX-specific swap building needs to be implemented
  // with the correct script addresses and datum schemas
  if (routes.length > 0) {
    // For now, we'll create a basic transaction structure
    // The actual swap logic needs to be implemented per DEX
    
    // Calculate total amounts
    let totalAmountIn = 0n;
    let totalAmountOut = 0n;
    
    for (const route of routes) {
      totalAmountIn += route.amountIn;
      totalAmountOut += route.amountOut;
    }

    // Calculate minimum amount out with slippage
    const minimumAmountOut = applySlippage(totalAmountOut, slippage, 'down');

    // Build the swap based on DEX type
    // TODO: Implement actual swap building for each DEX
    // This requires:
    // 1. Minswap: Order script address, order datum schema
    // 2. Splash: Pool script address, swap datum schema
    
    const firstRoute = routes[0];
    if (firstRoute.dexName === 'Minswap') {
      tx = await buildMinswapSwap(tx, firstRoute, minimumAmountOut, lucid);
    } else if (firstRoute.dexName === 'Splash') {
      tx = await buildSplashSwap(tx, firstRoute, minimumAmountOut, lucid);
    } else {
      throw new Error(`Unsupported DEX: ${firstRoute.dexName}`);
    }
  }

  // Handle script requirements if provided
  // Note: Lucid Evolution API may differ - this is a placeholder
  // TODO: Implement proper script attachment based on actual Lucid Evolution API
  if (script) {
    // tx.attachSpendingValidator might not exist in this version
    // This will need to be implemented based on actual API
    console.warn('Script attachment not yet implemented - needs Lucid Evolution API review');
    
    if (scriptRequirements) {
      for (const requirement of scriptRequirements) {
        if (requirement.code === 1 && typeof requirement.value === 'string') {
          tx = tx.addSignerKey(requirement.value);
        } else if (requirement.code === 2 && typeof requirement.value === 'number') {
          // Convert slot to unix time
          const unixTime = slotToUnixTime(requirement.value);
          tx = tx.validTo(unixTime);
        } else if (requirement.code === 3 && typeof requirement.value === 'number') {
          const unixTime = slotToUnixTime(requirement.value);
          tx = tx.validFrom(unixTime);
        }
      }
    }
  }

  // Complete the transaction (balance and select UTxOs)
  const completedTx = await tx.complete();

  // Get the unsigned transaction CBOR
  const txCbor = await completedTx.toString();

  // Normalize the CBOR (remove empty multiasset maps per CIP-21)
  const normalizedCbor = normalizeTransactionCbor(txCbor);

  return normalizedCbor;
}

/**
 * Build Minswap swap transaction
 * Note: This is a placeholder - actual implementation needs Minswap order script details
 */
async function buildMinswapSwap(
  tx: any,
  route: SwapRoute,
  minimumAmountOut: bigint,
  lucid: any
): Promise<any> {
  // TODO: Implement actual Minswap swap building
  // This would involve:
  // 1. Creating an order datum
  // 2. Sending assets to the Minswap order script
  // 3. Setting up the swap parameters
  
  // For now, this is a placeholder that would need the actual Minswap script addresses
  // and datum structures
  
  const assetInId = route.pool.assetA.policyId === "" 
    ? "lovelace" 
    : route.pool.assetA.policyId + route.pool.assetA.tokenName;
  
  const assetOutId = route.pool.assetB.policyId === "" 
    ? "lovelace" 
    : route.pool.assetB.policyId + route.pool.assetB.tokenName;

  // Placeholder: In practice, you'd need to:
  // 1. Pay to Minswap order script with order datum
  // 2. Include the swap parameters in the datum
  // 3. Handle the refund address
  
  console.warn('Minswap swap building not fully implemented - needs script addresses and datum schema');
  
  return tx;
}

/**
 * Build Splash swap transaction
 * Note: This is a placeholder - actual implementation needs Splash pool script details
 */
async function buildSplashSwap(
  tx: any,
  route: SwapRoute,
  minimumAmountOut: bigint,
  lucid: any
): Promise<any> {
  // TODO: Implement actual Splash swap building
  // This would involve:
  // 1. Spending from the Splash pool UTxO
  // 2. Providing the swap input
  // 3. Receiving the swap output
  // 4. Updating the pool reserves
  
  console.warn('Splash swap building not fully implemented - needs script addresses and datum schema');
  
  return tx;
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

