export interface SplashApiConfig {
  baseUrl: string;
  mempoolUrl: string;
}

const MAINNET_CONFIG: SplashApiConfig = {
  baseUrl: 'https://analytics.splash.trade/platform-api/v1/',
  mempoolUrl: 'https://analytics.splash.trade/mempool/v2/mempool/orders',
};

const PREPROD_CONFIG: SplashApiConfig = {
  baseUrl: 'https://api-test-preprod.splash.trade/v1/',
  mempoolUrl: 'https://api-test-preprod.splash.trade/mempool/v2/mempool/orders',
};

export function getSplashApiConfig(network: string): SplashApiConfig {
  switch (network) {
    case 'mainnet':
      return MAINNET_CONFIG;
    case 'preprod':
    case 'preview':
    case 'sanchonet':
      return PREPROD_CONFIG;
    default:
      return MAINNET_CONFIG;
  }
}



