import express, { Request, Response } from 'express';
import { getAssetPrice } from './minswap.js';
const app = express();
const port = 3000;

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

// Start the server
export function start(){
    app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}` );
    });
}