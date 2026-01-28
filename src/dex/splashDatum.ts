import { Constr, Data } from 'lucid-cardano';

export type PaymentCredential =
  | { paymentKeyHash: string }
  | { scriptHash: string };

export type StakeCredential =
  | { paymentKeyHash: string }
  | { scriptHash: string }
  | { slotNumber: bigint; transactionIndex: bigint; certificateIndex: bigint }
  | {};

export interface SpotOrderDatum {
  type: string;
  beacon: string;
  inputAsset: { policyId: string; name: string };
  inputAmount: bigint;
  costPerExStep: bigint;
  minMarginalOutput: bigint;
  outputAsset: { policyId: string; name: string };
  price: { numerator: bigint; denominator: bigint };
  executorFee: bigint;
  address: {
    paymentCredentials: PaymentCredential;
    stakeCredentials: StakeCredential;
  };
  cancelPkh: string;
  permittedExecutors: string[];
}

type PlutusConstr = {
  index: number;
  fields: unknown[];
};

function isConstr(value: unknown): value is PlutusConstr {
  return (
    typeof value === 'object' &&
    value !== null &&
    'index' in value &&
    'fields' in value &&
    Array.isArray((value as PlutusConstr).fields)
  );
}

function toHexString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString('hex');
  }
  return String(value);
}

function toBigInt(value: unknown, fieldName: string): bigint {
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'number') {
    return BigInt(value);
  }
  if (typeof value === 'string') {
    return BigInt(value);
  }
  throw new Error(`Unsupported ${fieldName} type: ${typeof value}`);
}

function parseAsset(data: unknown): { policyId: string; name: string } {
  if (!isConstr(data) || data.index !== 0) {
    throw new Error('Invalid asset datum');
  }
  return {
    policyId: toHexString(data.fields[0]),
    name: toHexString(data.fields[1]),
  };
}

function parsePaymentCredential(data: unknown): PaymentCredential {
  if (!isConstr(data)) {
    throw new Error('Invalid payment credential');
  }
  if (data.index === 0) {
    return { paymentKeyHash: toHexString(data.fields[0]) };
  }
  if (data.index === 1) {
    return { scriptHash: toHexString(data.fields[0]) };
  }
  throw new Error(`Unexpected payment credential index ${data.index}`);
}

function parseStakeCredential(data: unknown): StakeCredential {
  if (!isConstr(data)) {
    throw new Error('Invalid stake credential');
  }
  if (data.index === 1) {
    return {};
  }
  const inner = data.fields[0];
  if (!isConstr(inner)) {
    throw new Error('Invalid stake credential inner');
  }
  if (inner.index === 0) {
    const cred = inner.fields[0];
    return parsePaymentCredential(cred);
  }
  if (inner.index === 1) {
    return {
      slotNumber: toBigInt(inner.fields[0], 'slotNumber'),
      transactionIndex: toBigInt(inner.fields[1], 'transactionIndex'),
      certificateIndex: toBigInt(inner.fields[2], 'certificateIndex'),
    };
  }
  throw new Error(`Unexpected stake credential index ${inner.index}`);
}

function encodePaymentCredential(cred: PaymentCredential): Constr<unknown> {
  if ('paymentKeyHash' in cred) {
    return new Constr(0, [cred.paymentKeyHash]);
  }
  return new Constr(1, [cred.scriptHash]);
}

function encodeStakeCredential(cred: StakeCredential): Constr<unknown> {
  if ('paymentKeyHash' in cred || 'scriptHash' in cred) {
    return new Constr(0, [new Constr(0, [encodePaymentCredential(cred)])]);
  }
  if ('slotNumber' in cred) {
    return new Constr(0, [
      new Constr(1, [cred.slotNumber, cred.transactionIndex, cred.certificateIndex]),
    ]);
  }
  return new Constr(1, []);
}

export function decodeSpotOrderDatum(cbor: string): SpotOrderDatum {
  const data = Data.from(cbor);
  if (!isConstr(data) || data.index !== 0) {
    throw new Error('Invalid spot order datum');
  }

  const address = data.fields[9];
  if (!isConstr(address) || address.index !== 0) {
    throw new Error('Invalid address datum');
  }

  return {
    type: toHexString(data.fields[0]),
    beacon: toHexString(data.fields[1]),
    inputAsset: parseAsset(data.fields[2]),
    inputAmount: toBigInt(data.fields[3], 'inputAmount'),
    costPerExStep: toBigInt(data.fields[4], 'costPerExStep'),
    minMarginalOutput: toBigInt(data.fields[5], 'minMarginalOutput'),
    outputAsset: parseAsset(data.fields[6]),
    price: {
      numerator: toBigInt((data.fields[7] as PlutusConstr).fields[0], 'priceNumerator'),
      denominator: toBigInt((data.fields[7] as PlutusConstr).fields[1], 'priceDenominator'),
    },
    executorFee: toBigInt(data.fields[8], 'executorFee'),
    address: {
      paymentCredentials: parsePaymentCredential(address.fields[0]),
      stakeCredentials: parseStakeCredential(address.fields[1]),
    },
    cancelPkh: toHexString(data.fields[10]),
    permittedExecutors: (data.fields[11] as unknown[]).map(toHexString),
  };
}

export function encodeSpotOrderDatum(datum: SpotOrderDatum): string {
  assertSpotOrderDatum(datum);
  const address = new Constr(0, [
    encodePaymentCredential(datum.address.paymentCredentials),
    encodeStakeCredential(datum.address.stakeCredentials),
  ]);
  const price = new Constr(0, [datum.price.numerator, datum.price.denominator]);
  const data = new Constr(0, [
    datum.type,
    datum.beacon,
    new Constr(0, [datum.inputAsset.policyId, datum.inputAsset.name]),
    datum.inputAmount,
    datum.costPerExStep,
    datum.minMarginalOutput,
    new Constr(0, [datum.outputAsset.policyId, datum.outputAsset.name]),
    price,
    datum.executorFee,
    address,
    datum.cancelPkh,
    datum.permittedExecutors,
  ]);
  return Data.to(data as unknown as Data);
}

function assertHexString(value: string, label: string, allowEmpty = false): void {
  if (!allowEmpty && value.length === 0) {
    throw new Error(`${label} must not be empty`);
  }
  if (value.length % 2 !== 0) {
    throw new Error(`${label} must be even-length hex`);
  }
  if (!/^[0-9a-fA-F]*$/.test(value)) {
    throw new Error(`${label} must be hex`);
  }
}

function assertNonNegative(value: bigint, label: string): void {
  if (value < 0n) {
    throw new Error(`${label} must be non-negative`);
  }
}

function assertAsset(asset: { policyId: string; name: string }, label: string): void {
  if (asset.policyId.length !== 0 && asset.policyId.length !== 56) {
    throw new Error(`${label}.policyId must be 28 bytes hex or empty for ADA`);
  }
  assertHexString(asset.policyId, `${label}.policyId`, asset.policyId.length === 0);
  assertHexString(asset.name, `${label}.name`, true);
}

function assertCredential(cred: PaymentCredential | StakeCredential, label: string): void {
  if ('paymentKeyHash' in cred) {
    assertHexString(cred.paymentKeyHash, `${label}.paymentKeyHash`);
  } else if ('scriptHash' in cred) {
    assertHexString(cred.scriptHash, `${label}.scriptHash`);
  } else if ('slotNumber' in cred) {
    assertNonNegative(cred.slotNumber, `${label}.slotNumber`);
    assertNonNegative(cred.transactionIndex, `${label}.transactionIndex`);
    assertNonNegative(cred.certificateIndex, `${label}.certificateIndex`);
  }
}

export function assertSpotOrderDatum(datum: SpotOrderDatum): void {
  assertHexString(datum.type, 'type');
  assertHexString(datum.beacon, 'beacon');
  assertAsset(datum.inputAsset, 'inputAsset');
  assertAsset(datum.outputAsset, 'outputAsset');
  if (datum.inputAmount <= 0n) {
    throw new Error('inputAmount must be positive');
  }
  assertNonNegative(datum.costPerExStep, 'costPerExStep');
  assertNonNegative(datum.minMarginalOutput, 'minMarginalOutput');
  assertNonNegative(datum.executorFee, 'executorFee');
  if (datum.price.denominator <= 0n) {
    throw new Error('price.denominator must be positive');
  }
  assertCredential(datum.address.paymentCredentials, 'address.paymentCredentials');
  assertCredential(datum.address.stakeCredentials, 'address.stakeCredentials');
  assertHexString(datum.cancelPkh, 'cancelPkh', true);
  for (const executor of datum.permittedExecutors) {
    assertHexString(executor, 'permittedExecutors[]', true);
  }
}



