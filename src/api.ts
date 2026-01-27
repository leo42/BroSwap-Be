import express, { Request, Response } from 'express';
import cors from 'cors';
import { getAssetPrice , calculateAmountOut , getPendingOrders, createSwapTx , calculateAmountIn} from './minswap.js';
import { Asset } from '@minswap/sdk';
import { Lucid, Address, Blockfrost ,Network, Tx, Script} from 'lucid-cardano';
import BigNumber from 'bignumber.js';
import path from 'path';
import config from '../config.json' with { type: 'json' };
import verifiedTokens from '../availableTokens.json' with { type: 'json' };
import { fileURLToPath } from 'url';
import cbor from 'cbor';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Recursively normalizes a value to remove empty multiasset maps.
 * Cardano values should be just coin (number) when there are no tokens,
 * not a tuple [coin, multiasset] with empty multiasset.
 */
function normalizeValue(value: any): any {
  // If value is an array [coin, multiasset], check if multiasset is empty
  if (Array.isArray(value) && value.length === 2) {
    const [coin, multiasset] = value;
    
    // Check if multiasset is empty
    let isEmpty = false;
    if (multiasset === null || multiasset === undefined) {
      isEmpty = true;
    } else if (multiasset instanceof Map) {
      isEmpty = multiasset.size === 0;
    } else if (typeof multiasset === 'object') {
      isEmpty = Object.keys(multiasset).length === 0;
    }
    
    // If empty, return just coin; otherwise return the tuple
    if (isEmpty) {
      return coin;
    }
  }
  
  return value;
}

/**
 * Normalizes a Cardano transaction CBOR by removing empty multiasset maps from outputs.
 * This fixes CBOR canonical encoding violations per CIP-21.
 * @param txCborHex - Hex-encoded CBOR transaction
 * @returns Normalized hex-encoded CBOR transaction
 */
function normalizeTransactionCbor(txCborHex: string): string {
  try {
    // Decode hex to buffer
    const cborBuffer = Buffer.from(txCborHex, 'hex');
    
    // Decode CBOR to JavaScript object
    const tx = cbor.decodeFirstSync(cborBuffer);
    
    // Transaction structure: [body, witness_set, auxiliary_data?, valid?]
    // Body can be array or map depending on encoding
    let body: any = null;
    
    if (Array.isArray(tx) && tx.length >= 2) {
      body = tx[0];
    } else if (tx && typeof tx === 'object' && 'body' in tx) {
      body = tx.body;
    }
    
    if (!body) {
      return txCborHex;
    }
    
    // Body structure: array [inputs, outputs, fee, ...] or map with 'outputs' key
    let outputs: any[] | null = null;
    
    if (Array.isArray(body) && body.length >= 2) {
      // Outputs are at index 1 in array format
      outputs = body[1];
    } else if (body instanceof Map) {
      if (body.has(1)) {
        outputs = body.get(1);
      } else if (body.has('outputs')) {
        outputs = body.get('outputs');
      } else {
        for (const [key, value] of body.entries()) {
          if (key === 1 || (typeof key === 'string' && key.toLowerCase() === 'outputs')) {
            outputs = value;
            break;
          }
        }
      }
    } else if (body && typeof body === 'object' && 'outputs' in body) {
      outputs = body.outputs;
    } else if (body && typeof body === 'object') {
      // Try to find outputs by iterating (for map structures)
      for (const key in body) {
        if (key === '1' || (typeof key === 'string' && key.toLowerCase() === 'outputs')) {
          outputs = body[key];
          break;
        }
      }
    }
    
    if (!Array.isArray(outputs)) {
      return txCborHex;
    }
    
    // Normalize each output
    for (const output of outputs) {
      if (output && typeof output === 'object') {
        // Output structure: [address, amount, datum?, script_ref?] or {address, amount, ...}
        let amount: any = null;
        
        if (Array.isArray(output) && output.length >= 2) {
          amount = output[1];
          output[1] = normalizeValue(amount);
        } else if (output instanceof Map) {
          if (output.has(1)) {
            output.set(1, normalizeValue(output.get(1)));
          } else if (output.has('amount')) {
            output.set('amount', normalizeValue(output.get('amount')));
          } else {
            for (const [key, value] of output.entries()) {
              if (key === 1 || (typeof key === 'string' && key.toLowerCase() === 'amount')) {
                output.set(key, normalizeValue(value));
                break;
              }
            }
          }
        } else if (output && typeof output === 'object' && 'amount' in output) {
          amount = output.amount;
          output.amount = normalizeValue(amount);
        } else if (output && typeof output === 'object') {
          // Try to find amount by iterating (for map structures)
          for (const key in output) {
            if (key === '1' || (typeof key === 'string' && key.toLowerCase() === 'amount')) {
              output[key] = normalizeValue(output[key]);
              break;
            }
          }
        }
      }
    }
    
    // Re-encode to CBOR and return as hex
    const normalizedBuffer = cbor.encodeCanonical(tx);
    return normalizedBuffer.toString('hex');
  } catch (error) {
    console.error('Error normalizing transaction CBOR:', error);
    // Return original if normalization fails
    return txCborHex;
  }
}

const app = express();
const port = 3000;

// Enable CORS for all routes
app.use(cors());

// Middleware to parse JSON bodies
app.use(express.json());

// Serve static files from the 'assets' directory
app.use('/assets', express.static(path.join(__dirname, '..',  'assets')));

// Define a simple route
app.get('/', (req: Request, res: Response) => {
  res.send('Hello, TypeScript with Express!');
});

// Define another route
app.get('/api', (req: Request, res: Response) => {
  res.json({ message: 'Welcome to the API!' });
});

app.get('/api/asset-price', (req: Request, res: Response) => {
    const { policyId, tokenName } = req.query;
  
    if (typeof policyId !== 'string' || typeof tokenName !== 'string') {
      return res.status(400).json({ error: 'Invalid query parameters' });
    }
  
    getAssetPrice({ policyId, tokenName }).then((price) => {

        res.json({ price : Number(price) });
    }).catch((error) => {
        res.status(400).json({ error: error.message });
    });
});

app.get('/api/calculateIn', (req: Request, res: Response) => {
    const { amountOut, assetAPolicyId, assetATokenName, assetBPolicyId, assetBTokenName } = req.query;

// Replace missing policyId and tokenName with empty strings
const safeAssetAPolicyId = assetAPolicyId || "";
const safeAssetATokenName = assetATokenName || "";
const safeAssetBPolicyId = assetBPolicyId || "";
const safeAssetBTokenName = assetBTokenName || "";

if(typeof amountOut !== 'string' || typeof safeAssetAPolicyId !== 'string' || typeof safeAssetATokenName !== 'string' || typeof safeAssetBPolicyId !== 'string' || typeof safeAssetBTokenName !== 'string') {
    return res.status(400).json({ error: 'Invalid query parameters' });
}


if (typeof amountOut !== 'string' || typeof assetAPolicyId !== 'string' || typeof assetATokenName !== 'string' || typeof assetBPolicyId !== 'string' || typeof assetBTokenName !== 'string') {
    return res.status(400).json({ error: 'Invalid query parameters' });
  }

const assetA: Asset = { policyId: safeAssetAPolicyId, tokenName: safeAssetATokenName };
const assetB: Asset = { policyId: safeAssetBPolicyId, tokenName: safeAssetBTokenName };

    if (typeof amountOut !== 'string' || typeof assetAPolicyId !== 'string' || typeof assetATokenName !== 'string' || typeof assetBPolicyId !== 'string' || typeof assetBTokenName !== 'string') {
        return res.status(400).json({ error: 'Invalid query parameters' });
    }

    calculateAmountIn(assetA, assetB, BigInt(amountOut))
        .then((amountIn) => {
            res.json({ amountIn: amountIn[0].toString() , priceImpact: amountIn[1].toString() });

        })
        .catch((error) => {
            res.status(400).json({ error: error.message });
        });

    
    
    
}); 

app.get('/api/calculateOut', (req: Request, res: Response) => {
    
    const { amountIn, assetAPolicyId, assetATokenName, assetBPolicyId, assetBTokenName } = req.query;

    // Replace missing policyId and tokenName with empty strings
    const safeAssetAPolicyId = assetAPolicyId || "";
    const safeAssetATokenName = assetATokenName || "";
    const safeAssetBPolicyId = assetBPolicyId || "";
    const safeAssetBTokenName = assetBTokenName || "";
    
    if(typeof amountIn !== 'string' || typeof safeAssetAPolicyId !== 'string' || typeof safeAssetATokenName !== 'string' || typeof safeAssetBPolicyId !== 'string' || typeof safeAssetBTokenName !== 'string') {
        return res.status(400).json({ error: 'Invalid query parameters' });
    }

  
    if (typeof amountIn !== 'string' || typeof assetAPolicyId !== 'string' || typeof assetATokenName !== 'string' || typeof assetBPolicyId !== 'string' || typeof assetBTokenName !== 'string') {
        return res.status(400).json({ error: 'Invalid query parameters' });
      }
    
    const assetA: Asset = { policyId: safeAssetAPolicyId, tokenName: safeAssetATokenName };
    const assetB: Asset = { policyId: safeAssetBPolicyId, tokenName: safeAssetBTokenName };

    calculateAmountOut(assetA, assetB, BigInt(amountIn))
        .then((amountOut) => {
            res.json({ amountOut: amountOut[0].toString() , priceImpact: amountOut[1].toString() });
        })
        .catch((error) => {
            res.status(400).json({ error: error.message });
        });
}); 

app.get('/api/verified-tokens', async (req: Request, res: Response) => {
    const {search , page, pagination} = req.query;
    const safeSearch = search || "";
  console.log("geting token list", search, page, pagination, typeof safeSearch, typeof page, typeof pagination)  
    if(typeof safeSearch !== 'string' || typeof page !==  'string' || typeof pagination !== 'string') {
        return res.status(400).json({ error: 'Invalid query parameters' });
    }

    const filteredTokens = verifiedTokens.filter((token) => {
        return token.fullName.toLowerCase().includes(safeSearch.toLowerCase()) || token.ticker.toLowerCase().includes(safeSearch.toLowerCase());
    });
    const paginatedTokens = filteredTokens.slice((Number(page) - 1) * Number(pagination), Number(page) * Number(pagination));
    res.json({ tokens: paginatedTokens });

})


app.post('/api/swap', async (req: Request, res: Response) => {
    const { assetInPolicyId, assetInTokenName, assetOutPolicyId, utxos, assetOutTokenName, amountIn, slippage, address ,script = null , scriptRequirements = [] } = req.body;

    if (
        typeof assetInPolicyId !== 'string' ||
        typeof assetInTokenName !== 'string' ||
        typeof assetOutPolicyId !== 'string' ||
        typeof assetOutTokenName !== 'string' ||
        (script !== null && typeof script !== 'string') ||
        !Array.isArray(utxos) ||
        typeof amountIn !== 'string' ||
        typeof slippage !== 'string' ||
        typeof address !== 'string'
    ) {
        return res.status(400).json({ error: 'Invalid request parameters' });
    }

    const assetIn: Asset = { policyId: assetInPolicyId, tokenName: assetInTokenName };
    const assetOut: Asset = { policyId: assetOutPolicyId, tokenName: assetOutTokenName };

    let composeTx : Tx | undefined = undefined;

    if(script !== null){
      const network = config.network.charAt(0).toUpperCase() + config.network.slice(1) as Network;
      const lucid = await Lucid.new(new Blockfrost( config.blockfrost.url, config.blockfrost.projectId), network );
      const completeScript = {type : "Native", script: script} as Script
      composeTx  = lucid.newTx()
      
      composeTx.attachSpendingValidator(completeScript)
      if(composeTx !== undefined){
      scriptRequirements.forEach((requirement: ScriptRequirement) => {
              if(requirement.code === 1 && typeof requirement.value === 'string'){
                composeTx!.addSignerKey(requirement.value)
              }
              if(requirement.code === 2 && typeof requirement.value === 'number'){
                composeTx!.validTo(lucid.utils.slotToUnixTime(requirement.value))
              }
              if(requirement.code === 3 && typeof requirement.value === 'number'){
                  console.log("validFrom",requirement.value, lucid.utils.slotToUnixTime(requirement.value));
                  composeTx!.validFrom(lucid.utils.slotToUnixTime(requirement.value) )
              }});
            }
    }
    try {

        const slippageBN = new BigNumber(slippage);
        const tx = await createSwapTx(
            assetIn,
            assetOut,
            BigInt(amountIn),
            utxos,
            address as Address,
            slippageBN,
            composeTx
        );

        // Convert the transaction to CBOR
        const txCbor = await tx.toString();

        // Normalize the transaction to remove empty multiasset maps (CIP-21 compliance)
        const normalizedTxCbor = normalizeTransactionCbor(txCbor);

        res.json({
            txCbor: normalizedTxCbor,
            message: "Swap transaction created successfully. Sign and submit this transaction to complete the swap."
        });
    } catch (error) {
        console.error('Error creating swap transaction:', error);
        res.status(500).json({ error: 'Error creating swap transaction' });
    }
});

// Add a new API endpoint to use this function
app.get('/api/pending-orders/:address', async (req: Request, res: Response) => {
  const { address } = req.params;

  try {
    const pendingOrders = await getPendingOrders(address);
    res.json({ pendingOrders });
  } catch (error) {
    res.status(500).json({ error: 'Error fetching pending orders' });
  }
});

// Start the server
export function start(){
    app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}` );
    });
}