# Multi-DEX Implementation Notes

## Overview
The swap engine has been rewritten to support multiple DEXes (Minswap + Splash) with custom transaction building using Lucid Evolution instead of the deprecated Lucid SDK.

## Architecture Changes

### New Structure
- `src/dex/` - DEX adapter interfaces and implementations
  - `types.ts` - Common DEX types and interfaces
  - `minswapAdapter.ts` - Minswap DEX adapter
  - `splashAdapter.ts` - Splash DEX adapter (placeholder - needs script addresses)
  - `index.ts` - Exports

- `src/router/` - Route optimization
  - `quoteOptimizer.ts` - Finds best routes across DEXes with split routing

- `src/tx/` - Transaction building
  - `txBuilder.ts` - Lucid Evolution-based transaction builder (returns unsigned CBOR)

- `src/services/` - Service layer
  - `dexManager.ts` - Coordinates multiple DEX adapters

### Updated Files
- `src/api.ts` - Updated to use new DEX manager (API unchanged)
- `src/types.ts` - Added ScriptRequirement export

## Key Features

### 1. Multi-DEX Support
- Minswap adapter: Fully functional, uses on-chain Blockfrost data (SDK-free)
- Splash adapter: Structure in place, needs:
  - Pool script address
  - Pool datum schema
  - Swap transaction building logic

### 2. Route Optimization
- Automatically finds best route across available DEXes
- Supports split routing (e.g., 50% Minswap, 50% Splash)
- Tests multiple split ratios to maximize output

### 3. Transaction Building
- Uses Lucid Evolution for transaction building
- Returns unsigned CBOR (client signs)
- Maintains CBOR normalization (CIP-21 compliance)

## TODO / Next Steps

### Splash Integration
1. Provide Splash pool script address(es)
2. Provide pool datum schema
3. Implement pool discovery logic in `splashAdapter.ts`
4. Implement swap transaction building in `txBuilder.ts` -> `buildSplashSwap()`

### Minswap Transaction Building
1. Implement custom Minswap swap building (currently placeholder)
2. Requires:
   - Minswap order script address
   - Order datum schema
   - Swap parameter encoding

### Testing
- Add integration tests for quote optimization
- Add tests for transaction CBOR output
- Test with actual DEX pools

## API Compatibility
All existing API endpoints remain unchanged except pending-orders:
- `/api/calculateOut` - Now uses multi-DEX optimizer
- `/api/calculateIn` - Now uses multi-DEX optimizer
- `/api/asset-price` - Now uses multi-DEX optimizer
- `/api/swap` - Now uses new tx builder (returns same format)

## Dependencies Added
- `@lucid-evolution/lucid` - Transaction building
- `@blockfrost/blockfrost-js` - Blockfrost API (was already used via Minswap SDK)
- `bignumber.js` - Big number handling
- `cbor` - CBOR encoding/decoding

## Notes
- The implementation maintains backward compatibility where possible
- Splash adapter is a placeholder and will need actual implementation details
- Transaction building for both DEXes needs completion with actual script addresses and schemas
- The optimizer currently supports up to 2 DEXes but can be extended

