import assert from 'assert';
import { buildMinswapSwapExactInOrderOption } from '../dist/dex/minswapDatum.js';
import { encodeSpotOrderDatum } from '../dist/dex/splashDatum.js';

function expectThrow(fn, message) {
  let threw = false;
  try {
    fn();
  } catch (error) {
    threw = true;
  }
  assert.ok(threw, message);
}

const ada = { policyId: '', tokenName: '' };
const token = {
  policyId: '5deab590a137066fef0e56f06ef1b830f21bc5d544661ba570bdd2ae',
  tokenName: '424f44454741',
};

const route = {
  dexName: 'Minswap',
  pool: {
    assetA: ada,
    assetB: token,
    reserveA: 1n,
    reserveB: 1n,
    lpAsset: {
      policyId: 'f5808c2c990d86da54bfc97d89cee6efa20cd8461616359478d96b4c',
      tokenName: '4d5350',
    },
    fee: 30n,
    dexName: 'Minswap',
  },
  amountIn: 1_000_000n,
  amountOut: 500n,
  minimumAmountOut: 450n,
};

const order = buildMinswapSwapExactInOrderOption(
  route,
  ada,
  token,
  route.amountIn,
  route.minimumAmountOut
);
assert.equal(order.type, 0, 'expected SWAP_EXACT_IN type');
assert.equal(order.minimumAmountOut, route.minimumAmountOut, 'min out mismatch');

expectThrow(
  () =>
    buildMinswapSwapExactInOrderOption(
      route,
      { policyId: 'deadbeef', tokenName: '' },
      token,
      route.amountIn,
      route.minimumAmountOut
    ),
  'expected mismatch assetIn to throw'
);

const splashDatum = {
  type: '00',
  beacon: '11',
  inputAsset: { policyId: '', name: '' },
  inputAmount: 1_000_000n,
  costPerExStep: 0n,
  minMarginalOutput: 1n,
  outputAsset: { policyId: token.policyId, name: token.tokenName },
  price: { numerator: 1n, denominator: 1n },
  executorFee: 0n,
  address: { paymentCredentials: { paymentKeyHash: '00' }, stakeCredentials: {} },
  cancelPkh: '',
  permittedExecutors: [],
};

const cbor = encodeSpotOrderDatum(splashDatum);
assert.ok(typeof cbor === 'string' && cbor.length > 0, 'expected splash datum cbor');

expectThrow(
  () => encodeSpotOrderDatum({ ...splashDatum, type: '0' }),
  'expected odd-length hex to throw'
);

console.log('txBuilder tests passed');

