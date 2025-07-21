import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAccount, getMint } from '@solana/spl-token';
import { User } from '../models/User';
import { Asset } from '../models/Asset';
import { getTokenMetadata } from '../utils/tokenMetadata';
import { batchFetchTokenPrices, initializeRateLimiter } from '../utils/priceUtils';
import { ITokenAccountInfo } from '../types';

/**
 * Asset Discovery Job - Continuously monitors user wallets for token assets
 */
export class AssetDiscoveryJob {
  private connection: Connection;
  private rpcUrl: string;
  private coinveraApiKey: string;
  private rateLimitPerSecond: number;
  private isRunning = false;
  private intervalId?: NodeJS.Timeout;

  constructor(
    rpcUrl: string,
    coinveraApiKey: string,
    rateLimitPerSecond: number = 50
  ) {
    this.rpcUrl = rpcUrl;
    this.coinveraApiKey = coinveraApiKey;
    this.rateLimitPerSecond = rateLimitPerSecond;
    this.connection = new Connection(rpcUrl, 'confirmed');
    
    // Initialize rate limiter
    initializeRateLimiter(rateLimitPerSecond);
  }

  /**
   * Start the asset discovery job
   * @param {number} intervalMs - Interval in milliseconds between runs
   */
  public start(intervalMs: number = 10000): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    console.log(`🚀 Starting asset discovery job (interval: ${intervalMs}ms)`);

    // Run immediately
    this.runDiscovery();

    // Schedule recurring runs
    this.intervalId = setInterval(() => {
      this.runDiscovery();
    }, intervalMs);
  }

  /**
   * Stop the asset discovery job
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
  }

  /**
   * Run a single discovery cycle
   */
  private async runDiscovery(): Promise<void> {
    try {
      // Get all active users
      const users = await User.find({ status: 'active' });

      // Process each user's wallet
      for (const user of users) {
        await this.processUserWallet(user._id, user.wallet);
      }

      // Update prices for all existing assets
      await this.updateAssetPrices();
    } catch (error) {
      console.error('❌ Error in asset discovery cycle:', error);
    }
  }

  /**
   * Process a single user's wallet for token assets
   * @param {string} userId - User ID
   * @param {string} walletAddress - User's wallet address
   */
  private async processUserWallet(userId: string, walletAddress: string): Promise<void> {
    try {
      // Get all token accounts for this wallet
      const tokenAccounts = await this.getUserTokenAccounts(walletAddress);

      // Process each token account
      for (const tokenAccount of tokenAccounts) {
        await this.processTokenAccount(userId, tokenAccount);
      }
    } catch (error) {
      console.error(`Error processing wallet ${walletAddress}:`, error);
    }
  }

  /**
   * Get all token accounts for a user's wallet
   * @param {string} walletAddress - User's wallet address
   * @returns {Promise<ITokenAccountInfo[]>} Array of token account info
   */
  private async getUserTokenAccounts(walletAddress: string): Promise<ITokenAccountInfo[]> {
    try {
      const walletPubkey = new PublicKey(walletAddress);
      
      // Get all token accounts owned by this wallet
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
        walletPubkey,
        { programId: TOKEN_PROGRAM_ID }
      );

      const tokenAccountInfos: ITokenAccountInfo[] = [];

      for (const tokenAccount of tokenAccounts.value) {
        const parsedInfo = tokenAccount.account.data.parsed?.info;
        if (parsedInfo) {
          const balance = parsedInfo.tokenAmount?.uiAmount || 0;
          
          // Include all accounts with any balance (no dust filtering)
          if (balance > 0) {
            tokenAccountInfos.push({
              mint: parsedInfo.mint,
              tokenAccount: tokenAccount.pubkey.toBase58(),
              balance: balance,
              owner: parsedInfo.owner
            });
          }
        }
      }

      return tokenAccountInfos;
    } catch (error) {
      console.error(`Error getting token accounts for ${walletAddress}:`, error);
      return [];
    }
  }

  /**
   * Process a single token account
   * @param {string} userId - User ID
   * @param {ITokenAccountInfo} tokenAccountInfo - Token account information
   */
  private async processTokenAccount(userId: string, tokenAccountInfo: ITokenAccountInfo): Promise<void> {
    try {
      // Check if this asset already exists in database
      const existingAsset = await Asset.findOne({
        userId: userId,
        mint: tokenAccountInfo.mint
      });

      if (existingAsset) {
        // Update existing asset balance if it has changed
        if (existingAsset.balance !== tokenAccountInfo.balance) {
          existingAsset.updateBalance(tokenAccountInfo.balance);
          
          // If asset was marked as "sold" but now has any balance again, reactivate it (no dust filter)
          if (existingAsset.status === 'sold' && tokenAccountInfo.balance > 0) {
            existingAsset.status = 'available';
            console.log(`Reactivated sold asset: ${existingAsset.symbol} (${existingAsset.mint})`);
          }
          
          await existingAsset.save();
        }
      } else {
        // Create new asset entry
        await this.createNewAsset(userId, tokenAccountInfo);
      }
    } catch (error) {
      console.error(`Error processing token account ${tokenAccountInfo.tokenAccount}:`, error);
    }
  }

  /**
   * Create a new asset entry in the database
   * @param {string} userId - User ID
   * @param {ITokenAccountInfo} tokenAccountInfo - Token account information
   */
  private async createNewAsset(userId: string, tokenAccountInfo: ITokenAccountInfo): Promise<void> {
    try {
      // Get token metadata
      const metadata = await getTokenMetadata(tokenAccountInfo.mint, this.rpcUrl);
      
      // Create new asset
      const asset = new Asset({
        userId: userId,
        mint: tokenAccountInfo.mint,
        tokenAccount: tokenAccountInfo.tokenAccount,
        name: metadata.name,
        symbol: metadata.symbol,
        logo: metadata.logo,
        balance: tokenAccountInfo.balance,
        currentPrice: 0, // Will be updated by price update job
        currentValue: 0, // Will be calculated automatically
        status: 'available'
      });

      await asset.save();
    } catch (error) {
      console.error(`Error creating new asset for mint ${tokenAccountInfo.mint}:`, error);
    }
  }

  /**
   * Update prices for all existing assets
   */
  private async updateAssetPrices(): Promise<void> {
    try {
      // Get all unique mint addresses from available assets (skip sold tokens for price updates)
      const uniqueMints = await Asset.distinct('mint', { status: 'available' });

      if (uniqueMints.length === 0) {
        return;
      }

      // Batch fetch prices
      const priceMap = await batchFetchTokenPrices(uniqueMints, this.coinveraApiKey);

      // Update each asset with new price
      const updatePromises = Array.from(priceMap.entries()).map(([mint, price]) => {
        return this.updateAssetPrice(mint, price);
      });

      await Promise.all(updatePromises);
    } catch (error) {
      console.error('❌ Error updating asset prices:', error);
    }
  }

  /**
   * Update price for all assets of a specific mint
   * @param {string} mint - Token mint address
   * @param {number} price - New price in USD
   */
  private async updateAssetPrice(mint: string, price: number): Promise<void> {
    try {
      // Find all assets with this mint
      const assets = await Asset.find({ mint: mint, status: 'available' });

      // Update each asset
      const updatePromises = assets.map(asset => {
        asset.updatePrice(price);
        return asset.save();
      });

      await Promise.all(updatePromises);
    } catch (error) {
      console.error(`Error updating price for mint ${mint}:`, error);
    }
  }

  /**
   * Get job statistics
   * @returns {object} Job statistics
   */
  public getStats(): object {
    return {
      isRunning: this.isRunning,
      rpcUrl: this.rpcUrl,
      rateLimitPerSecond: this.rateLimitPerSecond,
      hasApiKey: !!this.coinveraApiKey,
      intervalActive: !!this.intervalId
    };
  }

  /**
   * Manual trigger for discovery (useful for testing)
   */
  public async triggerDiscovery(): Promise<void> {
    await this.runDiscovery();
  }
}

// Singleton instance
let assetDiscoveryJob: AssetDiscoveryJob | null = null;

/**
 * Initialize the asset discovery job
 * @param {string} rpcUrl - Solana RPC URL
 * @param {string} coinveraApiKey - Coinvera API key
 * @param {number} rateLimitPerSecond - Rate limit for API requests
 * @returns {AssetDiscoveryJob} Job instance
 */
export const initializeAssetDiscoveryJob = (
  rpcUrl: string,
  coinveraApiKey: string,
  rateLimitPerSecond: number = 50
): AssetDiscoveryJob => {
  if (!assetDiscoveryJob) {
    assetDiscoveryJob = new AssetDiscoveryJob(rpcUrl, coinveraApiKey, rateLimitPerSecond);
  }
  return assetDiscoveryJob;
};

/**
 * Get the asset discovery job instance
 * @returns {AssetDiscoveryJob | null} Job instance or null if not initialized
 */
export const getAssetDiscoveryJob = (): AssetDiscoveryJob | null => {
  return assetDiscoveryJob;
};

/**
 * Start the asset discovery job with environment configuration
 */
export const startAssetDiscoveryJob = (): void => {
  const rpcUrl = process.env.SOLANA_RPC_URL;
  const coinveraApiKey = process.env.COINVERA_APIKEY;
  const rateLimitPerSecond = parseInt(process.env.COINVERA_LIMIT || '50');
  const intervalMs = parseInt(process.env.ASSET_JOB_INTERVAL || '10000');
  const isEnabled = process.env.ASSET_JOB_ENABLED === 'true';

  if (!isEnabled) {
    return;
  }

  if (!rpcUrl || !coinveraApiKey) {
    console.error('Missing required environment variables for asset discovery job');
    return;
  }

  const job = initializeAssetDiscoveryJob(rpcUrl, coinveraApiKey, rateLimitPerSecond);
  job.start(intervalMs);
};

/**
 * Stop the asset discovery job
 */
export const stopAssetDiscoveryJob = (): void => {
  if (assetDiscoveryJob) {
    assetDiscoveryJob.stop();
  }
}; 