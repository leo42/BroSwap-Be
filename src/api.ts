import express, { Request, Response } from 'express';
import cors from 'cors';
import { getAssetPrice , calculateAmountOut , getPendingOrders, createSwapTx } from './minswap.js';
import { Asset } from '@minswap/sdk';
import { Lucid, Address, Blockfrost ,Network, Tx, Script} from 'lucid-cardano';
import BigNumber from 'bignumber.js';
import config from '../config.json' assert { type: 'json' };
import path from 'path';
import verifiedTokens from '../availableTokens.json' assert { type: 'json' };
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
            res.json({ amountOut: amountOut.toString() });
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
        typeof script !== 'string' ||
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

        res.json({
            txCbor: txCbor,
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