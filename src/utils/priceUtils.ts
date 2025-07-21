import { ICoinveraPriceResponse } from '../types';

// Rate limiting queue for API requests
class RateLimiter {
  private queue: Array<() => Promise<any>> = [];
  private processing = false;
  private lastRequestTime = 0;
  private requestsInSecond = 0;
  private secondStart = 0;
  private readonly maxRequestsPerSecond: number;
  private readonly minInterval: number;

  constructor(maxRequestsPerSecond: number = 50) {
    this.maxRequestsPerSecond = maxRequestsPerSecond;
    this.minInterval = 1000 / maxRequestsPerSecond; // Minimum time between requests
  }

  async addRequest<T>(requestFn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await requestFn();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      
      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0) {
      const now = Date.now();
      
      // Reset counter if we're in a new second
      if (now - this.secondStart >= 1000) {
        this.requestsInSecond = 0;
        this.secondStart = now;
      }

      // Check if we've hit the rate limit
      if (this.requestsInSecond >= this.maxRequestsPerSecond) {
        const waitTime = 1000 - (now - this.secondStart);
        await this.sleep(waitTime);
        continue;
      }

      // Ensure minimum interval between requests
      const timeSinceLastRequest = now - this.lastRequestTime;
      if (timeSinceLastRequest < this.minInterval) {
        await this.sleep(this.minInterval - timeSinceLastRequest);
      }

      const request = this.queue.shift();
      if (request) {
        this.lastRequestTime = Date.now();
        this.requestsInSecond++;
        await request();
      }
    }

    this.processing = false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Global rate limiter instance
let rateLimiter: RateLimiter;

/**
 * Initialize rate limiter with custom limit
 * @param {number} limit - Maximum requests per second
 */
export const initializeRateLimiter = (limit: number = 50): void => {
  rateLimiter = new RateLimiter(limit);
};

/**
 * Fetch token price from Coinvera API
 * @param {string} mintAddress - Token mint address
 * @param {string} apiKey - Coinvera API key
 * @returns {Promise<ICoinveraPriceResponse>} Price data
 */
export const fetchTokenPrice = async (
  mintAddress: string,
  apiKey: string
): Promise<ICoinveraPriceResponse> => {
  if (!rateLimiter) {
    initializeRateLimiter();
  }

  return rateLimiter.addRequest(async () => {
    try {
      const url = `https://api.coinvera.io/api/v1/price?ca=${mintAddress}`;
      
      const response = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json() as any;
      
      return {
        ca: mintAddress,
        dex: data.dex,
        poolId: data.poolId,
        liquidity: data.liquidity,
        priceInSol: data.priceInSol,
        priceInUsd: data.priceInUsd
      };
    } catch (error) {
      console.error(`Error fetching price for ${mintAddress}:`, error);
      return {
        ca: mintAddress,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });
};

/**
 * Fetch prices for multiple tokens
 * @param {string[]} mintAddresses - Array of token mint addresses
 * @param {string} apiKey - Coinvera API key
 * @returns {Promise<ICoinveraPriceResponse[]>} Array of price data
 */
export const fetchTokenPrices = async (
  mintAddresses: string[],
  apiKey: string
): Promise<ICoinveraPriceResponse[]> => {
  if (!rateLimiter) {
    initializeRateLimiter();
  }

  // Create array of price fetch promises
  const pricePromises = mintAddresses.map(mintAddress => 
    fetchTokenPrice(mintAddress, apiKey)
  );

  // Wait for all promises to resolve
  const results = await Promise.all(pricePromises);
  
  return results;
};

/**
 * Extract USD price from Coinvera response
 * @param {ICoinveraPriceResponse} response - Coinvera API response
 * @returns {number} USD price or 0 if not available
 */
export const extractUsdPrice = (response: ICoinveraPriceResponse): number => {
  if (response.error) {
    return 0;
  }

  if (response.priceInUsd) {
    const price = parseFloat(response.priceInUsd);
    return isNaN(price) ? 0 : price;
  }

  return 0;
};

/**
 * Batch process token prices with proper rate limiting
 * @param {string[]} mintAddresses - Array of token mint addresses
 * @param {string} apiKey - Coinvera API key
 * @param {number} batchSize - Size of each batch (default: 10)
 * @returns {Promise<Map<string, number>>} Map of mint address to USD price
 */
export const batchFetchTokenPrices = async (
  mintAddresses: string[],
  apiKey: string,
  batchSize: number = 10
): Promise<Map<string, number>> => {
  const priceMap = new Map<string, number>();
  
  // Process tokens in batches
  for (let i = 0; i < mintAddresses.length; i += batchSize) {
    const batch = mintAddresses.slice(i, i + batchSize);
    
    try {
      const responses = await fetchTokenPrices(batch, apiKey);
      
      responses.forEach(response => {
        const price = extractUsdPrice(response);
        priceMap.set(response.ca, price);
      });
      
      // Log progress
  
    } catch (error) {
      console.error(`Error processing batch ${i / batchSize + 1}:`, error);
      
      // Add zero prices for failed batch
      batch.forEach(mintAddress => {
        priceMap.set(mintAddress, 0);
      });
    }
  }
  
  return priceMap;
};

/**
 * Get rate limiter statistics
 * @returns {object} Rate limiter statistics
 */
export const getRateLimiterStats = (): object => {
  if (!rateLimiter) {
    return { status: 'not_initialized' };
  }
  
  return {
    status: 'active',
    queueLength: (rateLimiter as any).queue.length,
    processing: (rateLimiter as any).processing,
    maxRequestsPerSecond: (rateLimiter as any).maxRequestsPerSecond
  };
};

/**
 * Clear rate limiter queue (useful for testing)
 */
export const clearRateLimiterQueue = (): void => {
  if (rateLimiter) {
    (rateLimiter as any).queue = [];
  }
}; 