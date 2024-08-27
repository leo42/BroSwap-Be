import express, { Request, Response } from 'express';
import cors from 'cors';
import { getAssetPrice , calculateAmountOut, calculateAmountIn , createSwapTx } from './minswap.js';
import { Asset } from '@minswap/sdk';
const app = express();
const port = 3000;

// Add CORS middleware
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

app.get('/api/calculateOut', (req: Request, res: Response) => {
    


    const { amountIn, assetAPolicyId, assetATokenName, assetBPolicyId, assetBTokenName } = req.query;

    console.log('Debug:', { amountIn, assetAPolicyId, assetATokenName, assetBPolicyId, assetBTokenName });
    // Replace missing policyId and tokenName with empty strings
    const safeAssetAPolicyId = assetAPolicyId || "";
    const safeAssetATokenName = assetATokenName || "";
    const safeAssetBPolicyId = assetBPolicyId || "";
    const safeAssetBTokenName = assetBTokenName || "";
    
    if(typeof amountIn !== 'string' || typeof safeAssetAPolicyId !== 'string' || typeof safeAssetATokenName !== 'string' || typeof safeAssetBPolicyId !== 'string' || typeof safeAssetBTokenName !== 'string') {
        return res.status(400).json({ error: 'Invalid query parameters' });
    }

    // Log the types of the parameters
    console.log('Parameter types:', {
        amountIn: typeof amountIn,
        assetAPolicyId: typeof assetAPolicyId,
        assetATokenName: typeof assetATokenName,
        assetBPolicyId: typeof assetBPolicyId,
        assetBTokenName: typeof assetBTokenName
    });

    
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

// Start the server
export function start(){
    app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}` );
    });
}