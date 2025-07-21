import { InvalidatedToken } from '../models/InvalidatedToken';

/**
 * Token Cleanup Job - Automatically removes old invalidated tokens
 * Note: MongoDB TTL index handles most cleanup automatically, but this provides manual cleanup and monitoring
 */
export class TokenCleanupJob {
  private isRunning = false;
  private intervalId?: NodeJS.Timeout;
  private runCount = 0;
  private lastRun?: Date;
  private lastCleanedCount = 0;

  /**
   * Start the token cleanup job
   * @param {number} intervalMs - Interval in milliseconds between runs (default: 24 hours)
   */
  public start(intervalMs: number = 24 * 60 * 60 * 1000): void { // 24 hours default
    if (this.isRunning) {
      console.log('🔄 Token cleanup job is already running');
      return;
    }

    this.isRunning = true;
    console.log(`🚀 Starting token cleanup job (interval: ${intervalMs / 1000 / 60 / 60}h)`);

    // Run immediately
    this.runCleanup();

    // Schedule recurring runs
    this.intervalId = setInterval(() => {
      this.runCleanup();
    }, intervalMs);
  }

  /**
   * Stop the token cleanup job
   */
  public stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    console.log('🛑 Token cleanup job stopped');
  }

  /**
   * Run a single cleanup cycle
   */
  private async runCleanup(): Promise<void> {
    try {
      console.log('🧹 Starting token cleanup cycle...');
      
      // Clean up old tokens (older than 8 days)
      const cleanedCount = await (InvalidatedToken as any).cleanupOldTokens();
      
      this.lastRun = new Date();
      this.runCount++;
      this.lastCleanedCount = cleanedCount;
      
      if (cleanedCount > 0) {
        console.log(`✅ Token cleanup completed: ${cleanedCount} old tokens removed`);
      } else {
        console.log('✅ Token cleanup completed: No old tokens to remove');
      }
      
    } catch (error) {
      console.error('❌ Error in token cleanup cycle:', error);
    }
  }

  /**
   * Manual trigger for cleanup (useful for testing or manual cleanup)
   */
  public async triggerCleanup(): Promise<number> {
    console.log('🔧 Manual token cleanup triggered');
    const cleanedCount = await (InvalidatedToken as any).cleanupOldTokens();
    console.log(`✅ Manual cleanup completed: ${cleanedCount} tokens removed`);
    return cleanedCount;
  }

  /**
   * Get job statistics
   * @returns {object} Job statistics
   */
  public getStats(): object {
    return {
      isRunning: this.isRunning,
      runCount: this.runCount,
      lastRun: this.lastRun || null,
      lastCleanedCount: this.lastCleanedCount,
      nextRun: this.isRunning && this.intervalId ? 
        new Date(Date.now() + (24 * 60 * 60 * 1000)) : null, // Approximate next run
      intervalActive: !!this.intervalId
    };
  }

  /**
   * Get token statistics from database
   */
  public async getTokenStats(): Promise<object> {
    try {
      const totalInvalidated = await InvalidatedToken.countDocuments();
      
      const recentStats = await InvalidatedToken.aggregate([
        {
          $group: {
            _id: '$reason',
            count: { $sum: 1 }
          }
        }
      ]);

      const reasonStats = recentStats.reduce((acc: any, item: any) => {
        acc[item._id] = item.count;
        return acc;
      }, {});

      // Get tokens invalidated in last 24 hours
      const yesterday = new Date();
      yesterday.setHours(yesterday.getHours() - 24);
      const recentInvalidated = await InvalidatedToken.countDocuments({ 
        invalidatedAt: { $gte: yesterday } 
      });

      return {
        totalInvalidatedTokens: totalInvalidated,
        recentInvalidated24h: recentInvalidated,
        reasonBreakdown: {
          logout: reasonStats.logout || 0,
          expired: reasonStats.expired || 0,
          security: reasonStats.security || 0
        }
      };
    } catch (error) {
      console.error('Error getting token stats:', error);
      return {
        totalInvalidatedTokens: 0,
        recentInvalidated24h: 0,
        reasonBreakdown: {
          logout: 0,
          expired: 0,
          security: 0
        }
      };
    }
  }
}

// Singleton instance
let tokenCleanupJob: TokenCleanupJob | null = null;

/**
 * Initialize the token cleanup job
 * @returns {TokenCleanupJob} Job instance
 */
export const initializeTokenCleanupJob = (): TokenCleanupJob => {
  if (!tokenCleanupJob) {
    tokenCleanupJob = new TokenCleanupJob();
  }
  return tokenCleanupJob;
};

/**
 * Get the token cleanup job instance
 * @returns {TokenCleanupJob | null} Job instance or null if not initialized
 */
export const getTokenCleanupJob = (): TokenCleanupJob | null => {
  return tokenCleanupJob;
};

/**
 * Start the token cleanup job with default configuration
 */
export const startTokenCleanupJob = (): void => {
  const job = initializeTokenCleanupJob();
  job.start(); // Start with default 24-hour interval
};

/**
 * Stop the token cleanup job
 */
export const stopTokenCleanupJob = (): void => {
  if (tokenCleanupJob) {
    tokenCleanupJob.stop();
  }
}; 