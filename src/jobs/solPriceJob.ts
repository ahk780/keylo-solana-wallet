import cron from 'node-cron';
import { fetchTokenPrice } from '../utils/priceUtils';
import { ISolPriceData } from '../types';

// USDT mint address
const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

// Cache for SOL price data
let solPriceCache: ISolPriceData | null = null;

// Track job status
let jobStatus = {
  isRunning: false,
  lastRun: null as Date | null,
  nextRun: null as Date | null,
  runCount: 0,
  errors: [] as string[]
};

// Cron job reference
let cronJob: cron.ScheduledTask | null = null;

/**
 * Calculate SOL price from USDT price data
 * @param {string} priceInSol - USDT price in SOL
 * @param {string} priceInUsd - USDT price in USD
 * @returns {number} SOL price in USD
 */
const calculateSolPrice = (priceInSol: string, priceInUsd: string): number => {
  try {
    const usdtPriceInSol = parseFloat(priceInSol);
    const usdtPriceInUsd = parseFloat(priceInUsd);
    
    // Validate inputs
    if (isNaN(usdtPriceInSol) || isNaN(usdtPriceInUsd) || usdtPriceInSol <= 0 || usdtPriceInUsd <= 0) {
      return 0;
    }
    
    // Calculate SOL price: if 1 USDT = 0.01 SOL and 1 USDT = $1.00, then 1 SOL = $100
    const solPriceUsd = usdtPriceInUsd / usdtPriceInSol;
    
    // Validate result
    if (isNaN(solPriceUsd) || solPriceUsd <= 0 || solPriceUsd > 10000) {
      return 0;
    }
    
    return solPriceUsd;
  } catch (error) {
    console.error('Error calculating SOL price:', error);
    return 0;
  }
};

/**
 * Run the SOL price update
 */
const runSolPriceUpdate = async (): Promise<void> => {
  if (jobStatus.isRunning) {
    return;
  }

  jobStatus.isRunning = true;
  jobStatus.lastRun = new Date();
  jobStatus.runCount++;

  try {
    // Get API key from environment
    const apiKey = process.env.COINVERA_APIKEY;
    if (!apiKey) {
      throw new Error('COINVERA_APIKEY not configured');
    }

    // Fetch USDT price data
    const usdtPriceResponse = await fetchTokenPrice(USDT_MINT, apiKey);
    
    if (usdtPriceResponse.error) {
      throw new Error(`Failed to fetch USDT price: ${usdtPriceResponse.error}`);
    }

    // Validate required fields
    if (!usdtPriceResponse.priceInSol || !usdtPriceResponse.priceInUsd) {
      throw new Error('Invalid USDT price data: missing priceInSol or priceInUsd');
    }

    // Calculate SOL price
    const solPriceUsd = calculateSolPrice(usdtPriceResponse.priceInSol, usdtPriceResponse.priceInUsd);
    
    if (solPriceUsd <= 0) {
      throw new Error('Invalid SOL price calculation result');
    }

    // Update cache
    solPriceCache = {
      solPriceUsd: solPriceUsd,
      usdtPriceInSol: parseFloat(usdtPriceResponse.priceInSol),
      usdtPriceInUsd: parseFloat(usdtPriceResponse.priceInUsd),
      lastUpdated: new Date(),
      source: 'coinvera-usdt-calculation',
      isValid: true
    };

    // Clear old errors on successful run
    if (jobStatus.errors.length > 0) {
      jobStatus.errors = [];
    }
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    console.error('❌ SOL price update failed:', errorMessage);
    
    // Keep last 5 errors
    jobStatus.errors.push(`${new Date().toISOString()}: ${errorMessage}`);
    if (jobStatus.errors.length > 5) {
      jobStatus.errors.shift();
    }

    // Mark cache as invalid if we have old data
    if (solPriceCache) {
      solPriceCache.isValid = false;
    }
  } finally {
    jobStatus.isRunning = false;
    
    // Calculate next run time (1 minute from now)
    jobStatus.nextRun = new Date(Date.now() + 60 * 1000);
  }
};

/**
 * Start the SOL price monitoring job
 */
export const startSolPriceJob = async (): Promise<void> => {
  console.log('🚀 Starting SOL price monitoring job...');
  
  // Run immediately on start
  await runSolPriceUpdate();
  
  // Schedule to run every minute
  cronJob = cron.schedule('* * * * *', async () => {
    await runSolPriceUpdate();
  }, {
    scheduled: true,
    timezone: 'UTC'
  });

  console.log('⏰ SOL price job scheduled to run every minute');
};

/**
 * Stop the SOL price monitoring job
 */
export const stopSolPriceJob = (): void => {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    console.log('🛑 SOL price job stopped');
  }
};

/**
 * Get current cached SOL price data
 * @returns {ISolPriceData | null} Cached SOL price data or null if not available
 */
export const getCachedSolPrice = (): ISolPriceData | null => {
  return solPriceCache;
};

/**
 * Get job status information
 * @returns {object} Job status information
 */
export const getSolPriceJobStatus = (): object => {
  return {
    ...jobStatus,
    cacheStatus: solPriceCache ? {
      isValid: solPriceCache.isValid,
      lastUpdated: solPriceCache.lastUpdated,
      solPriceUsd: solPriceCache.solPriceUsd
    } : null
  };
};

/**
 * Force refresh SOL price data
 * @returns {Promise<ISolPriceData | null>} Updated SOL price data or null if failed
 */
export const forceRefreshSolPrice = async (): Promise<ISolPriceData | null> => {
  await runSolPriceUpdate();
  return solPriceCache;
}; 