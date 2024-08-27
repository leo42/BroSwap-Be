import express, { Request, Response } from 'express';
import cors from 'cors';
import { getAssetPrice , calculateAmountOut , getPendingOrders} from './minswap.js';
import { Asset } from '@minswap/sdk';
const app = express();
const port = 3000;

// Enable CORS for all routes
app.use(cors());

// Middleware to parse JSON bodies
app.use(express.json());

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


app.get('/api/swap', (req: Request, res: Response) => {
    const { policyId, tokenName } = req.query;

    if (typeof policyId !== 'string' || typeof tokenName !== 'string') {
      return res.status(400).json({ error: 'Invalid query parameters' });
    }

    const { amountIn, slippage } = req.body;

    if (typeof amountIn !== 'string' || typeof slippage !== 'string') {
        return res.status(400).json({ error: 'Invalid query parameters' });
      }

      const assetA = { policyId, tokenName };
      const assetB = { policyId: "", tokenName: "LOVELACE" };
      
    
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