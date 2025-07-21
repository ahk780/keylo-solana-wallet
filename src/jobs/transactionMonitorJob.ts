import { rpcTransactionMonitor } from '../services/rpcTransactionMonitor';
import { IApiResponse } from '../types';

interface TransactionMonitorJobStatus {
  isRunning: boolean;
  monitoredUsers: number;
  solPriceCached: boolean;
  solPriceAge: number;
  startTime?: Date;
  lastActivity?: Date;
}

class TransactionMonitorJob {
  private isRunning = false;
  private startTime?: Date;

  /**
   * Start the fast RPC transaction monitoring job
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      console.log('🚀 RPC transaction monitor job is already running');
      return;
    }

    try {
      this.isRunning = true;
      this.startTime = new Date();
      
      console.log('🚀 Starting fast RPC transaction monitoring job...');
      await rpcTransactionMonitor.startMonitoring();
      
      console.log('✅ Fast RPC transaction monitoring job started successfully');
    } catch (error) {
      console.error('❌ Error starting fast RPC transaction monitoring job:', error);
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * Stop the transaction monitoring job
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      console.log('⚠️ Transaction monitor job is not running');
      return;
    }

    try {
      console.log('🛑 Stopping fast RPC transaction monitoring job...');
      await rpcTransactionMonitor.stopMonitoring();
      
      this.isRunning = false;
      this.startTime = undefined;
      
      console.log('✅ Fast RPC transaction monitoring job stopped successfully');
    } catch (error) {
      console.error('❌ Error stopping transaction monitoring job:', error);
      throw error;
    }
  }

  /**
   * Restart the transaction monitoring job
   */
  public async restart(): Promise<void> {
    console.log('🔄 Restarting fast RPC transaction monitoring job...');
    await this.stop();
    await new Promise(resolve => setTimeout(resolve, 2000)); // Brief pause
    await this.start();
  }

  /**
   * Get job status
   */
  public getStatus(): TransactionMonitorJobStatus {
    const monitorStatus = rpcTransactionMonitor.getStatus();
    
    return {
      isRunning: this.isRunning && monitorStatus.isRunning,
      monitoredUsers: monitorStatus.monitoredUsers,
      solPriceCached: monitorStatus.solPriceCached,
      solPriceAge: monitorStatus.solPriceAge,
      startTime: this.startTime,
      lastActivity: new Date()
    };
  }

  /**
   * Manually sync all users (initial sync)
   */
  public async syncAllUsers(): Promise<IApiResponse> {
    try {
      console.log('🔄 Manual sync requested for all users...');
      await rpcTransactionMonitor.syncAllUsers();
      
      return {
        success: true,
        message: 'Manual sync completed successfully for all users'
      };
    } catch (error) {
      console.error('❌ Error during manual sync:', error);
      return {
        success: false,
        message: 'Manual sync failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Add new user to monitoring
   */
  public async addUser(userId: string, walletAddress: string): Promise<IApiResponse> {
    try {
      console.log(`➕ Adding user ${userId} to fast RPC monitoring...`);
      await rpcTransactionMonitor.addUser(userId, walletAddress);
      
      return {
        success: true,
        message: `User ${userId} added to monitoring successfully`
      };
    } catch (error) {
      console.error(`❌ Error adding user ${userId} to monitoring:`, error);
      return {
        success: false,
        message: `Failed to add user ${userId} to monitoring`,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Remove user from monitoring
   */
  public removeUser(userId: string): IApiResponse {
    try {
      console.log(`➖ Removing user ${userId} from monitoring...`);
      rpcTransactionMonitor.removeUser(userId);
      
      return {
        success: true,
        message: `User ${userId} removed from monitoring successfully`
      };
    } catch (error) {
      console.error(`❌ Error removing user ${userId} from monitoring:`, error);
      return {
        success: false,
        message: `Failed to remove user ${userId} from monitoring`,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}

// Singleton instance
const transactionMonitorJob = new TransactionMonitorJob();

/**
 * Start the fast RPC transaction monitoring job
 */
export const startTransactionMonitorJob = async (): Promise<void> => {
  await transactionMonitorJob.start();
};

/**
 * Stop the transaction monitoring job
 */
export const stopTransactionMonitorJob = async (): Promise<void> => {
  await transactionMonitorJob.stop();
};

/**
 * Restart the transaction monitoring job
 */
export const restartTransactionMonitorJob = async (): Promise<void> => {
  await transactionMonitorJob.restart();
};

/**
 * Get transaction monitoring job status
 */
export const getTransactionMonitorJobStatus = (): TransactionMonitorJobStatus => {
  return transactionMonitorJob.getStatus();
};

/**
 * Manually sync all users
 */
export const syncAllUsers = async (): Promise<IApiResponse> => {
  return await transactionMonitorJob.syncAllUsers();
};

/**
 * Add user to monitoring
 */
export const addUserToMonitoring = async (userId: string, walletAddress: string): Promise<IApiResponse> => {
  return await transactionMonitorJob.addUser(userId, walletAddress);
};

/**
 * Remove user from monitoring
 */
export const removeUserFromMonitoring = (userId: string): IApiResponse => {
  return transactionMonitorJob.removeUser(userId);
}; 