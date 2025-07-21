import fetch from 'node-fetch';
import { ICoinveraTrendingResponse, ICoinveraTrendingToken, ITrendingTokenData } from '../types';
import { getTokenMetadata, cleanExpiredCache } from './tokenMetadata';

// Cache structure for trending tokens
interface TrendingCache {
  data: ITrendingTokenData[];
  lastUpdated: number;
  isUpdating: boolean;
}

// Valid time periods for trending tokens
const VALID_HOURS = [1, 6, 12, 24];
const DEFAULT_LIMIT = 20;

// Cache for trending tokens by hour
const trendingCache: { [key: number]: TrendingCache } = {};

/**
 * Initialize trending cache with empty data for all valid hours
 */
export const initializeTrendingCache = (): void => {
  VALID_HOURS.forEach(hour => {
    trendingCache[hour] = {
      data: [],
      lastUpdated: 0,
      isUpdating: false
    };
  });
};

/**
 * Fetch trending tokens from Coinvera API (without metadata)
 * @param {number} hour - Time period (1, 6, 12, or 24)
 * @param {number} limit - Number of tokens to fetch
 * @returns {Promise<ICoinveraTrendingToken[]>} Array of trending tokens without metadata
 */
const fetchTrendingTokensFromCoinvera = async (hour: number, limit: number): Promise<ICoinveraTrendingToken[]> => {
  try {
    // Validate environment variables
    if (!process.env.COINVERA_APIKEY) {
      throw new Error('COINVERA_APIKEY environment variable is not set');
    }

    // Fetch trending tokens from Coinvera API
    const coinveraUrl = `https://api.coinvera.io/api/v1/trend?x-api-key=${process.env.COINVERA_APIKEY}&hour=${hour}&limit=${limit}`;
    
    const coinveraResponse = await fetch(coinveraUrl);
    
    if (!coinveraResponse.ok) {
      throw new Error(`Coinvera API error: ${coinveraResponse.status} ${coinveraResponse.statusText}`);
    }

    const coinveraData = await coinveraResponse.json() as ICoinveraTrendingResponse;

    // Extract token data from response
    const tokenData: ICoinveraTrendingToken[] = [];
    for (const [key, value] of Object.entries(coinveraData)) {
      // Skip the hour and limit properties
      if (key === 'hour' || key === 'limit') continue;
      
      // Add token data
      tokenData.push(value as ICoinveraTrendingToken);
    }

    return tokenData;

  } catch (error) {
    return [];
  }
};

/**
 * Update trending cache for a specific time period (non-blocking)
 * @param {number} hour - Time period to update
 */
export const updateTrendingCache = async (hour: number): Promise<void> => {
  if (!VALID_HOURS.includes(hour)) {
    return;
  }

  // Check if already updating
  if (trendingCache[hour].isUpdating) {
    return;
  }

  trendingCache[hour].isUpdating = true;

  try {
    const tokenData = await fetchTrendingTokensFromCoinvera(hour, DEFAULT_LIMIT);
    
    // Fetch metadata for each token using simplified flow
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    const metadataPromises = tokenData.map(token => getTokenMetadata(token.token_address, rpcUrl));
    const metadataResults = await Promise.all(metadataPromises);

    // Combine trending data with metadata
    const trendingTokens: ITrendingTokenData[] = tokenData.map((token, index) => {
      const metadata = metadataResults[index];
      
      return {
        mint: token.token_address,
        name: metadata.name,
        symbol: metadata.symbol,
        logo: metadata.logo,
        buy_volume_usd: token.buy_volume_usd,
        latest_price: token.latest_price,
        net_inflow_usd: token.net_inflow_usd,
        sell_volume_usd: token.sell_volume_usd
      };
    });
    
    // Update cache
    trendingCache[hour] = {
      data: trendingTokens,
      lastUpdated: Date.now(),
      isUpdating: false
    };

  } catch (error) {
    trendingCache[hour].isUpdating = false;
  }
};

/**
 * Update all trending caches (non-blocking)
 */
export const updateAllTrendingCaches = async (): Promise<void> => {
  // Clean expired metadata cache first
  cleanExpiredCache();
  
  // Update all time periods in parallel
  const updatePromises = VALID_HOURS.map(hour => updateTrendingCache(hour));
  await Promise.all(updatePromises);
};

/**
 * Get cached trending tokens for a specific time period (non-blocking)
 * @param {number} hour - Time period (1, 6, 12, or 24)
 * @returns {ITrendingTokenData[]} Array of cached trending tokens
 */
export const getCachedTrendingTokens = (hour: number): ITrendingTokenData[] => {
  if (!VALID_HOURS.includes(hour)) {
    return [];
  }

  const cachedData = trendingCache[hour];
  
  // If cache is stale, trigger background update but still return current data
  if (cachedData && cachedData.data.length > 0 && isTrendingCacheStale(hour) && !cachedData.isUpdating) {
    // Non-blocking background update
    updateTrendingCache(hour).catch(() => {
      // Silent error handling
    });
  }
  
  return cachedData?.data || [];
};

/**
 * Check if trending cache is stale for a specific time period
 * @param {number} hour - Time period to check
 * @returns {boolean} True if cache is stale or empty
 */
export const isTrendingCacheStale = (hour: number): boolean => {
  if (!VALID_HOURS.includes(hour)) {
    return true;
  }

  const cachedData = trendingCache[hour];
  if (!cachedData || cachedData.data.length === 0) {
    return true;
  }

  // Cache is stale if it's older than 1 hour
  const staleTime = 60 * 60 * 1000; // 1 hour in milliseconds
  return Date.now() - cachedData.lastUpdated > staleTime;
};

/**
 * Get trending cache status for monitoring
 * @returns {object} Cache status for all time periods
 */
export const getTrendingCacheStatus = (): object => {
  const status: any = {};
  
  VALID_HOURS.forEach(hour => {
    const cache = trendingCache[hour];
    status[`${hour}h`] = {
      tokensCount: cache.data.length,
      lastUpdated: new Date(cache.lastUpdated).toISOString(),
      isUpdating: cache.isUpdating,
      isStale: isTrendingCacheStale(hour)
    };
  });

  return status;
};

/**
 * Get valid hour periods
 * @returns {number[]} Array of valid hour periods
 */
export const getValidHours = (): number[] => {
  return [...VALID_HOURS];
};

/**
 * Get default limit
 * @returns {number} Default limit for trending tokens
 */
export const getDefaultLimit = (): number => {
  return DEFAULT_LIMIT;
}; 