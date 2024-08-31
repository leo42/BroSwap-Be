import { BlockFrostAPI } from "@blockfrost/blockfrost-js";
import { BlockfrostAdapter, DexV2Calculation, DexV2, OrderV2, Asset, NetworkId, PoolV2 } from "@minswap/sdk";
import { Lucid, Address, UTxO, TxComplete, Data , Blockfrost, Tx, Network} from "lucid-cardano";
import BigNumber from "bignumber.js";
type CardanoNetwork = 'mainnet' | 'preview' | 'preprod' | 'sanchonet';

// load the config.json file    
import config from '../config.json' assert { type: 'json' };

const ADA: Asset = {
  policyId: "",
  tokenName: ""
}

namespace Slippage {
  export function apply({
      slippage,
      amount,
      type,
  }: {
      slippage: BigNumber;
      amount: bigint;
      type: "up" | "down";
  }): bigint {
      switch (type) {
          case "up": {
              const slippageAdjustedAmount = new BigNumber(1).plus(slippage).multipliedBy(amount.toString());
              return BigInt(slippageAdjustedAmount.toFixed(0, BigNumber.ROUND_DOWN));
          }
          case "down": {
              const slippageAdjustedAmount = new BigNumber(1)
                  .div(new BigNumber(1).plus(slippage))
                  .multipliedBy(amount.toString());
              return BigInt(slippageAdjustedAmount.toFixed(0, BigNumber.ROUND_DOWN));
          }
      }
  }
}

// Add this new function
export async function getPendingOrders(userAddress: string): Promise<OrderV2.Datum[]> {
  const lucid = await Lucid.new(undefined, 'Mainnet');
  const adapter = new BlockfrostAdapter({ 
    networkId: NetworkId.MAINNET, 
    blockFrost: new BlockFrostAPI({ 
      projectId:  config.blockfrost.projectId
    })
  });

  const dexV2 = new DexV2(lucid, adapter);
  const orderScriptAddress = await dexV2['buildOrderAddress']();

  const utxos = await lucid.utxosAt(orderScriptAddress);
  const pendingOrders: OrderV2.Datum[] = [];

  for (const utxo of utxos) {
    if (utxo.datum) {
      try {
        const datumCbor = await adapter.getDatumByDatumHash(utxo.datum);
        const datum = OrderV2.Datum.fromPlutusData(NetworkId.MAINNET, Data.from(datumCbor));
        if (datum.refundReceiver === userAddress) {
          pendingOrders.push(datum);
        }
      } catch (error) {
        console.error('Error processing UTxO:', error);
      }
    }
  }

  return pendingOrders;
}


const api = new BlockfrostAdapter(
    {
    networkId : 0,
    blockFrost: new BlockFrostAPI({
      projectId: config.blockfrost.projectId,
      network: config.network as CardanoNetwork,
    }),
  });

export function test()  {
  api.getAllV2Pools().then((pools) => {
  });


  console.log('test minswap function');
}

// Add these new variables
let allPools: PoolV2.State[] = [];
let lastFetchTime = 0;
const FETCH_INTERVAL = 60000; // 1 minute in milliseconds

// Add this new function to fetch all pools
async function fetchAllPools() {
  const currentTime = Date.now();
  if (currentTime - lastFetchTime < FETCH_INTERVAL) {
    return; // Don't fetch if it's been less than a minute since the last fetch
  }

  try {
    const { pools, errors } = await api.getAllV2Pools();
    if (errors.length > 0) {
      console.error('Errors while fetching pools:', errors);
    }
    allPools = pools;
    lastFetchTime = currentTime;
    console.log(`Fetched ${pools.length} pools at ${new Date().toISOString()}`);
  } catch (error) {
    console.error('Error fetching all pools:', error);
  }
}

// Modify the getV2PoolByPair function to use the cached pools
async function getV2PoolByPair(assetA: Asset, assetB: Asset): Promise<PoolV2.State | null> {
  await fetchAllPools(); // This will only fetch if it's been more than a minute since the last fetch

  const pool = allPools.find(p => 
    (p.assetA === Asset.toString(assetA) && p.assetB === Asset.toString(assetB)) ||
    (p.assetA === Asset.toString(assetB) && p.assetB === Asset.toString(assetA))
  );

  return pool || null;
}

export async function calculateAmountOut(assetA: Asset, assetB: Asset, amountIn: bigint): Promise<bigint> {
  const pool = await getV2PoolByPair(assetA, assetB);
  if (!pool) {
    throw new Error("Pool not found");
  }
  
  const assetAId = assetA.policyId === "" ? "lovelace": assetA.policyId + assetA.tokenName;
  const assetBId = assetB.policyId === "" ? "lovelace": assetB.policyId + assetB.tokenName;
  console.log('calculateAmountOut', assetAId, assetBId, pool.reserveA, pool.reserveB);  
  const reserveIn = assetAId === pool.assetA ? pool.reserveA : pool.reserveB;
  const reserveOut = assetBId === pool.assetB ? pool.reserveB : pool.reserveA;
  
  console.log('calculateAmountOut', assetAId, assetBId, pool.reserveA, pool.reserveB, reserveIn, reserveOut, amountIn, pool.feeA[0], pool.assetA, pool.assetB);

  return DexV2Calculation.calculateAmountOut({
    reserveIn: reserveIn,
    reserveOut: reserveOut,
    amountIn: amountIn,
    tradingFeeNumerator: pool.feeA[0],
  });
}

export async function calculateAmountIn(assetA: Asset, assetB: Asset, amountOut: bigint): Promise<bigint> {
  const pool = await getV2PoolByPair(assetA, assetB);
  if (!pool) {
    throw new Error("Pool not found");
  }

  const assetAId = assetA.policyId === "" ? "lovelace": assetA.policyId + assetA.tokenName;
  const assetBId = assetB.policyId === "" ? "lovelace": assetB.policyId + assetB.tokenName;

  const reserveIn = assetAId === pool.assetA ? pool.reserveA : pool.reserveB;
  const reserveOut = assetBId === pool.assetB ? pool.reserveB : pool.reserveA;

  return DexV2Calculation.calculateAmountIn({
    reserveIn: reserveIn,
    reserveOut: reserveOut,
    amountOut: amountOut,
    tradingFeeNumerator: pool.feeA[0],
  });
}

export async function createSwapTx(assetA: Asset, assetB: Asset, amountIn: bigint, utxos: UTxO[], address: Address, slippage: BigNumber, composeTx: Tx | null = null): Promise<TxComplete> {
  const pool = await getV2PoolByPair(assetA, assetB);
  if (!pool) {
    throw new Error("Pool not found");
  }
  const authorizationMethodType = composeTx ? OrderV2.AuthorizationMethodType.SPEND_SCRIPT : OrderV2.AuthorizationMethodType.SIGNATURE;
  const network = config.network.charAt(0).toUpperCase() + config.network.slice(1) as Network;
  const lucid = await Lucid.new(new Blockfrost(config.blockfrost.url, config.blockfrost.projectId), network);
  lucid.selectWalletFrom({address, utxos});
  const amountOut = await calculateAmountOut(assetA, assetB, amountIn);
  const minimumAmountOut = Slippage.apply({ slippage, amount: amountOut, type: "down" });
  const typedUtxos = utxos.map(utxo => ({
    ...utxo,
    assets: Object.fromEntries(
      Object.entries(utxo.assets).map(([key, value]) => [key, BigInt(value)])
    )
  }));
  
  try {
    const result = await new DexV2(lucid, api).createBulkOrdersTx({
      sender: address,
      availableUtxos: typedUtxos,
      orderOptions: [{
        type: OrderV2.StepType.SWAP_EXACT_IN,
        amountIn: BigInt(amountIn),
        assetIn: assetA,
        direction: assetA.policyId === "" ? OrderV2.Direction.A_TO_B : OrderV2.Direction.B_TO_A,
        minimumAmountOut: BigInt(minimumAmountOut),
        lpAsset: pool.lpAsset,
        isLimitOrder: false,
        killOnFailed: true,
      }],
      authorizationMethodType: authorizationMethodType,
      composeTx: composeTx ? composeTx : undefined,
    });
    return result;
  }catch (error) {
    console.error('Error in createBulkOrdersTx:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }
    throw new Error('Error creating swap transaction: ' + (error instanceof Error ? error.message : String(error)));
  }
}



export async function getAssetPrice(asset: Asset): Promise<Number> {
  console.log('getAssetPrice', asset);
  const pool = await getV2PoolByPair(ADA, asset);
  if (!pool) {
    throw new Error("Pool not found");
  }
  
  return 1/Number(DexV2Calculation.calculateAmountOut({
    reserveIn: pool.reserveA,
    reserveOut: pool.reserveB,
    amountIn: 1_000_000n,
    tradingFeeNumerator: pool.feeA[0],
  }));
}


async function _swapExactInV2TxExample(
    lucid: Lucid,
    blockfrostAdapter: BlockfrostAdapter,
    address: Address,
    availableUtxos: UTxO[]
  ): Promise<TxComplete> {
    const assetA = ADA;
    const assetB = ADA;
  
    const pool = await getV2PoolByPair(assetA, assetB);
    if (!pool) {
      throw new Error("Pool not found");
    }
    const swapAmount = 5_000_000n;
    const amountOut = DexV2Calculation.calculateAmountOut({
      reserveIn: pool.reserveA,
      reserveOut: pool.reserveB,
      amountIn: swapAmount,
      tradingFeeNumerator: pool.feeA[0],
    });
    // 20%
    const slippageTolerance = new BigNumber(20).div(100);
    const acceptedAmountOut = Slippage.apply({
      slippage: slippageTolerance,
      amount: amountOut,
      type: "down",
    });
  
    return new DexV2(lucid, blockfrostAdapter).createBulkOrdersTx({
      sender: address,
      availableUtxos: availableUtxos,
      orderOptions: [
        {
          type: OrderV2.StepType.SWAP_EXACT_IN,
          amountIn: swapAmount,
          assetIn: assetA,
          direction: OrderV2.Direction.A_TO_B,
          minimumAmountOut: acceptedAmountOut,
          lpAsset: pool.lpAsset,
          isLimitOrder: false,
          killOnFailed: false,
        },
      ],
    });
  }