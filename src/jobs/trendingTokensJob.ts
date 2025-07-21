import cron from 'node-cron';
import { 
  initializeTrendingCache, 
  updateAllTrendingCaches, 
  getTrendingCacheStatus 
} from '../utils/trendingService';

// Track job status
let jobStatus = {
  isRunning: false,
  lastRun: null as Date | null,
  nextRun: null as Date | null,
  runCount: 0,
  errors: [] as string[]
};

/**
 * Run the trending tokens cache update
 */
const runTrendingUpdate = async (): Promise<void> => {
  if (jobStatus.isRunning) {
    return;
  }

  jobStatus.isRunning = true;
  jobStatus.lastRun = new Date();
  jobStatus.runCount++;

  try {
    // Update all trending caches
    await updateAllTrendingCaches();
    
    // Clear old errors on successful run
    if (jobStatus.errors.length > 0) {
      jobStatus.errors = [];
    }
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    
    // Keep last 5 errors
    jobStatus.errors.push(`${new Date().toISOString()}: ${errorMessage}`);
    if (jobStatus.errors.length > 5) {
      jobStatus.errors.shift();
    }
  } finally {
    jobStatus.isRunning = false;
    
    // Calculate next run time (30 minutes from now)
    jobStatus.nextRun = new Date(Date.now() + 30 * 60 * 1000);
  }
};

/**
 * Initialize and start the trending tokens background job
 */
export const startTrendingTokensJob = async (): Promise<void> => {
  // Initialize cache
  initializeTrendingCache();
  
  // Run initial update
  await runTrendingUpdate();
  
  // Schedule to run every 30 minutes
  cron.schedule('*/30 * * * *', async () => {
    await runTrendingUpdate();
  }, {
    scheduled: true,
    timezone: 'UTC'
  });
};

/**
 * Get job status for monitoring
 * @returns {object} Job status information
 */
export const getTrendingJobStatus = (): object => {
  return {
    isRunning: jobStatus.isRunning,
    lastRun: jobStatus.lastRun ? jobStatus.lastRun.toISOString() : null,
    nextRun: jobStatus.nextRun ? jobStatus.nextRun.toISOString() : null,
    runCount: jobStatus.runCount,
    errors: jobStatus.errors,
    cacheStatus: getTrendingCacheStatus()
  };
};

/**
 * Manually trigger trending cache update (useful for testing)
 */
export const triggerTrendingUpdate = async (): Promise<void> => {
  await runTrendingUpdate();
}; 