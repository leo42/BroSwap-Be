import { loadConfig } from '../utils/configLoader.js';

export interface SplashOrderConfig {
  orderAddress: string;
  orderType: string;
  beacon: string;
  batcherFee: bigint;
  depositAda: bigint;
  costPerExStep: bigint;
  executorFee: bigint;
}

function getEnvBigInt(name: string): bigint | null {
  const raw = process.env[name];
  if (!raw) {
    return null;
  }
  return BigInt(raw);
}

export function getSplashOrderConfig(): SplashOrderConfig | null {
  const config = loadConfig();
  const orderAddress = config.splash?.orderAddress || process.env.SPLASH_ORDER_ADDRESS;
  const orderType = config.splash?.orderType || process.env.SPLASH_ORDER_TYPE;
  const beacon = config.splash?.beacon || process.env.SPLASH_ORDER_BEACON;
  const batcherFee =
    config.splash?.batcherFee !== undefined
      ? BigInt(config.splash.batcherFee)
      : getEnvBigInt('SPLASH_BATCHER_FEE');
  const depositAda =
    config.splash?.depositAda !== undefined
      ? BigInt(config.splash.depositAda)
      : getEnvBigInt('SPLASH_DEPOSIT_ADA');
  const costPerExStep =
    config.splash?.costPerExStep !== undefined
      ? BigInt(config.splash.costPerExStep)
      : getEnvBigInt('SPLASH_COST_PER_EX_STEP');
  const executorFee =
    config.splash?.executorFee !== undefined
      ? BigInt(config.splash.executorFee)
      : getEnvBigInt('SPLASH_EXECUTOR_FEE');

  if (
    !orderAddress ||
    !orderType ||
    !beacon ||
    batcherFee === null ||
    depositAda === null ||
    costPerExStep === null ||
    executorFee === null
  ) {
    return null;
  }

  return {
    orderAddress,
    orderType,
    beacon,
    batcherFee,
    depositAda,
    costPerExStep,
    executorFee,
  };
}

