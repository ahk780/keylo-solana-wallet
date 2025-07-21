import { Order } from '../models/Order';
import { User } from '../models/User';
import { Asset } from '../models/Asset';
import { Wallet } from '../models/Wallet';
import { fetchTokenPrice, extractUsdPrice } from '../utils/priceUtils';
import { getCachedSolPrice } from './solPriceJob';
import { IOrder } from '../types';
import { Keypair, VersionedTransaction } from '@solana/web3.js';
import { decryptPrivateKey } from '../utils/encryption';
import { SOL_MINT } from '../utils/transfer';
import bs58 from 'bs58';

// Token mint addresses
const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// Job status tracking
let jobStatus = {
  isRunning: false,
  lastRun: null as Date | null,
  nextRun: null as Date | null,
  runCount: 0,
  processedOrders: 0,
  executedOrders: 0,
  failedOrders: 0,
  errors: [] as string[]
};

// Job interval reference
let jobInterval: NodeJS.Timeout | null = null;

/**
 * Determine which asset to use for SOL trading (USDT or USDC)
 * @param {string} userId - User ID
 * @param {number} requiredAmount - Required amount in USD
 * @returns {Promise<{mint: string, symbol: string} | null>} Asset to use or null if insufficient funds
 */
const getAssetForSolTrading = async (userId: string, requiredAmount: number): Promise<{mint: string, symbol: string} | null> => {
  try {
    // Get user's USDT and USDC assets
    const [usdtAsset, usdcAsset] = await Promise.all([
      Asset.findOne({ userId, mint: USDT_MINT, status: 'available' }),
      Asset.findOne({ userId, mint: USDC_MINT, status: 'available' })
    ]);

    const usdtBalance = usdtAsset ? usdtAsset.balance : 0;
    const usdcBalance = usdcAsset ? usdcAsset.balance : 0;

    // Check if user has sufficient balance in either asset
    const hasEnoughUSDT = usdtBalance >= requiredAmount;
    const hasEnoughUSDC = usdcBalance >= requiredAmount;

    if (!hasEnoughUSDT && !hasEnoughUSDC) {
      console.log(`User ${userId} has insufficient balance for SOL order. USDT: ${usdtBalance}, USDC: ${usdcBalance}, Required: ${requiredAmount}`);
      return null;
    }

    // Prefer USDT if both have enough balance, otherwise use the one with enough balance
    if (hasEnoughUSDT) {
      return { mint: USDT_MINT, symbol: 'USDT' };
    } else {
      return { mint: USDC_MINT, symbol: 'USDC' };
    }
  } catch (error) {
    console.error('Error checking user assets for SOL trading:', error);
    return null;
  }
};

/**
 * Execute a limit order using SolanaPortal
 * @param {IOrder} order - The order to execute
 * @returns {Promise<string | null>} Transaction signature or null if failed
 */
const executeOrder = async (order: IOrder): Promise<string | null> => {
  try {
    // Get SolanaPortal API URL (same as trading controller)
    const SOLANA_PORTAL_API = 'https://api.solanaportal.io/api/trading';
    const JITO_API = 'https://tokyo.mainnet.block-engine.jito.wtf/api/v1/transactions';

    // Get user's wallet and private key
    const user = await User.findById(order.userId);
    if (!user) {
      console.error('User not found for order:', order._id);
      return null;
    }
    
    const userWallet = await Wallet.findOne({ userId: order.userId });
    if (!userWallet) {
      console.error('User wallet not found for order:', order._id);
      return null;
    }

    // Check if encryption key is available
    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      console.error('ENCRYPTION_KEY not configured');
      return null;
    }

    // Decrypt private key
    let privateKey: string;
    try {
      privateKey = decryptPrivateKey(userWallet.privateKey, encryptionKey);
    } catch (error) {
      console.error('Failed to decrypt private key for order:', order._id, error);
      return null;
    }

    // Create wallet keypair
    let wallet: Keypair;
    try {
      wallet = Keypair.fromSecretKey(bs58.decode(privateKey));
    } catch (error) {
      console.error('Failed to create wallet keypair for order:', order._id, error);
      return null;
    }
    
    const userWalletAddress = user.wallet;

    // Handle SOL orders specially
    if (order.mint === SOL_MINT) {
      let tradeRequest: any;
      
      if (order.type === 'buy') {
        // Buy SOL: sell USDT/USDC to get SOL
        // Get current SOL price from cache to calculate how much USDT/USDC to sell
        const cachedSolPrice = getCachedSolPrice();
        if (!cachedSolPrice) {
          console.error(`SOL price not available for buy order ${order._id}`);
          return null;
        }
        
        const requiredAmount = order.amount * cachedSolPrice.solPriceUsd; // Calculate required USD amount based on current SOL price
        const assetToUse = await getAssetForSolTrading(order.userId, requiredAmount);
        
        if (!assetToUse) {
          console.error(`User ${order.userId} has insufficient USDT/USDC balance for SOL buy order ${order._id}`);
          return null;
        }

        tradeRequest = {
          wallet_address: userWalletAddress,
          action: 'sell', // Sell USDT/USDC to get SOL
          dex: 'jupiter', // Always use Jupiter for SOL orders
          mint: assetToUse.mint, // USDT or USDC mint (what we're selling)
          amount: requiredAmount, // Amount of USDT/USDC to sell
          slippage: order.slippage,
          tip: order.tip,
          type: 'jito'
        };

        console.log(`🔄 Executing SOL buy order ${order._id}: selling ${requiredAmount} ${assetToUse.symbol} (at $${cachedSolPrice.solPriceUsd}/SOL) to get ${order.amount} SOL`);
      } else {
        // Sell SOL: buy USDT/USDC with SOL
        // When selling SOL, we want to buy USDT (prefer USDT over USDC)
        // Check which stablecoin user prefers (USDT first, then USDC)
        const hasUsdtAsset = await Asset.findOne({ userId: order.userId, mint: USDT_MINT });
        const hasUsdcAsset = await Asset.findOne({ userId: order.userId, mint: USDC_MINT });
        
        // Default to USDT, fallback to USDC if user doesn't have USDT asset
        const targetMint = (hasUsdtAsset || !hasUsdcAsset) ? USDT_MINT : USDC_MINT;
        const targetSymbol = (hasUsdtAsset || !hasUsdcAsset) ? 'USDT' : 'USDC';

        tradeRequest = {
          wallet_address: userWalletAddress,
          action: 'buy', // Buy USDT/USDC with SOL
          dex: 'jupiter', // Always use Jupiter for SOL orders
          mint: targetMint, // USDT or USDC mint (what we want to buy)
          amount: order.amount, // Amount of SOL to spend
          slippage: order.slippage,
          tip: order.tip,
          type: 'jito'
        };

        console.log(`🔄 Executing SOL sell order ${order._id}: selling ${order.amount} SOL to buy ${targetSymbol}`);
      }

      // Execute the SOL trade
      const response = await fetch(SOLANA_PORTAL_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(tradeRequest)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('SolanaPortal API error for SOL order:', errorText);
        return null;
      }

      // Get unsigned transaction
      const transactionData = await response.json() as string;
      const txnBuffer = Buffer.from(transactionData, 'base64');
      const txn = VersionedTransaction.deserialize(txnBuffer);

      // Sign transaction
      txn.sign([wallet]);
      const signedTxn = bs58.encode(txn.serialize());

      // Submit to Jito
      const jitoResponse = await fetch(JITO_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'sendTransaction',
          params: [signedTxn]
        })
      });

      if (!jitoResponse.ok) {
        const errorText = await jitoResponse.text();
        console.error('Jito submission failed for SOL order:', errorText);
        return null;
      }

      const jitoResult = await jitoResponse.json() as any;
      
      if (!jitoResult.result) {
        console.error('SOL order transaction failed - no signature received');
        return null;
      }

      return jitoResult.result as string;
    } else {
      // Handle regular token orders
      const tradeRequest = {
        wallet_address: userWalletAddress,
        action: order.type,
        dex: order.dex,
        mint: order.mint,
        amount: order.amount,
        slippage: order.slippage,
        tip: order.tip,
        type: 'jito'
      };

      // Execute the trade
      const response = await fetch(SOLANA_PORTAL_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(tradeRequest)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('SolanaPortal API error:', errorText);
        return null;
      }

      // Get unsigned transaction
      const transactionData = await response.json() as string;
      const txnBuffer = Buffer.from(transactionData, 'base64');
      const txn = VersionedTransaction.deserialize(txnBuffer);

      // Sign transaction
      txn.sign([wallet]);
      const signedTxn = bs58.encode(txn.serialize());

      // Submit to Jito
      const jitoResponse = await fetch(JITO_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'sendTransaction',
          params: [signedTxn]
        })
      });

      if (!jitoResponse.ok) {
        const errorText = await jitoResponse.text();
        console.error('Jito submission failed:', errorText);
        return null;
      }

      const jitoResult = await jitoResponse.json() as any;
      
      if (!jitoResult.result) {
        console.error('Transaction failed - no signature received');
        return null;
      }

      return jitoResult.result as string;
    }

  } catch (error) {
    console.error('Error executing order:', error);
    return null;
  }
};

/**
 * Check if order should be triggered based on current price and order type
 * @param {IOrder} order - The order to check
 * @param {number} currentPrice - Current market price
 * @returns {boolean} True if order should be triggered
 */
const shouldTriggerOrder = (order: IOrder, currentPrice: number): boolean => {
  if (order.orderType === 'low') {
    // Low order: trigger when current price reaches or goes below trigger price
    return currentPrice <= order.triggerPrice;
  } else if (order.orderType === 'high') {
    // High order: trigger when current price reaches or goes above trigger price
    return currentPrice >= order.triggerPrice;
  }
  return false;
};

/**
 * Process a single order: update price and execute if triggered
 * @param {IOrder} order - The order to process
 * @returns {Promise<boolean>} True if order was processed successfully
 */
const processOrder = async (order: IOrder): Promise<boolean> => {
  try {
    let currentPrice: number;

    // Special handling for SOL mint
    if (order.mint === SOL_MINT) {
      const cachedSolPrice = getCachedSolPrice();
      if (!cachedSolPrice) {
        console.warn(`SOL price not available for order ${order._id}`);
        return false;
      }
      currentPrice = cachedSolPrice.solPriceUsd;
    } else {
      // Get API key
      const apiKey = process.env.COINVERA_APIKEY;
      if (!apiKey) {
        console.error('COINVERA_APIKEY not configured');
        return false;
      }

      // Fetch current price
      const priceResponse = await fetchTokenPrice(order.mint, apiKey);
      currentPrice = extractUsdPrice(priceResponse);

      if (currentPrice <= 0) {
        console.warn(`Failed to get price for token ${order.mint} in order ${order._id}`);
        return false;
      }
    }

    // Update current price in order
    order.currentPrice = currentPrice;

    // Check if order should be triggered
    if (shouldTriggerOrder(order, currentPrice)) {
      console.log(`🎯 Triggering order ${order._id}: ${order.type} ${order.amount} ${order.symbol} at $${currentPrice}`);
      
      // Execute the order
      const signature = await executeOrder(order);
      
      if (signature) {
        // Order executed successfully
        order.signature = signature;
        order.status = 'triggered';
        jobStatus.executedOrders++;
        console.log(`✅ Order ${order._id} executed successfully. Signature: ${signature}`);
      } else {
        // Order execution failed
        order.status = 'failed';
        jobStatus.failedOrders++;
        console.log(`❌ Order ${order._id} execution failed`);
      }
    }

    // Save the updated order
    try {
      await order.save();
    } catch (saveError: any) {
      // Handle case where order was deleted while processing
      if (saveError.name === 'DocumentNotFoundError' || saveError.message.includes('No document found')) {
        console.log(`Order ${order._id} was deleted while being processed, skipping...`);
        return true; // Order was deleted, so it's effectively "processed"
      }
      throw saveError; // Re-throw other save errors
    }
    return true;

  } catch (error) {
    console.error(`Error processing order ${order._id}:`, error);
    
    // Mark order as failed on critical errors (but only if it still exists)
    try {
      // Check if order still exists before trying to update it
      const existingOrder = await Order.findById(order._id);
      if (existingOrder) {
        existingOrder.status = 'failed';
        await existingOrder.save();
        jobStatus.failedOrders++;
      } else {
        console.log(`Order ${order._id} was deleted while being processed, cannot mark as failed`);
      }
    } catch (saveError: any) {
      if (saveError.name === 'DocumentNotFoundError' || saveError.message.includes('No document found')) {
        console.log(`Order ${order._id} was deleted while trying to mark as failed`);
      } else {
        console.error('Failed to save failed order status:', saveError);
      }
    }
    
    return false;
  }
};

/**
 * Main job execution function
 */
const runLimitOrdersJob = async (): Promise<void> => {
  if (jobStatus.isRunning) {
    return; // Job is already running
  }

  jobStatus.isRunning = true;
  jobStatus.lastRun = new Date();
  jobStatus.runCount++;

  try {
    // Get all waiting orders
    const waitingOrders = await Order.find({ status: 'waiting' });
    
    if (waitingOrders.length === 0) {
      return; // No orders to process
    }

    jobStatus.processedOrders = 0;
    
    // Process orders one by one with 5-second delay between each
    for (const order of waitingOrders) {
      try {
        // Verify order still exists and has waiting status before processing
        const currentOrder = await Order.findById(order._id);
        if (currentOrder && currentOrder.status === 'waiting') {
          await processOrder(currentOrder);
          jobStatus.processedOrders++;
        } else if (currentOrder) {
          console.log(`Order ${order._id} status changed to ${currentOrder.status}, skipping...`);
        } else {
          console.log(`Order ${order._id} was deleted, skipping...`);
        }
        
        // Wait 5 seconds before processing next order to respect rate limits
        if (jobStatus.processedOrders < waitingOrders.length) {
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      } catch (error) {
        console.error(`Error checking order ${order._id} before processing:`, error);
        // Continue with next order
      }
    }

    // Clear old errors on successful run
    if (jobStatus.errors.length > 0) {
      jobStatus.errors = [];
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    console.error('❌ Limit orders job failed:', errorMessage);
    
    // Keep last 10 errors
    jobStatus.errors.push(`${new Date().toISOString()}: ${errorMessage}`);
    if (jobStatus.errors.length > 10) {
      jobStatus.errors.shift();
    }
  } finally {
    jobStatus.isRunning = false;
    jobStatus.nextRun = new Date(Date.now() + 60 * 1000); // Next run in 1 minute
  }
};

/**
 * Start the limit orders monitoring job
 */
export const startLimitOrdersJob = (): void => {
  console.log('🚀 Starting limit orders monitoring job...');
  
  // Run immediately on start
  runLimitOrdersJob();
  
  // Schedule to run every minute
  jobInterval = setInterval(runLimitOrdersJob, 60 * 1000);
  
  console.log('⏰ Limit orders job scheduled to run every minute');
};

/**
 * Stop the limit orders monitoring job
 */
export const stopLimitOrdersJob = (): void => {
  if (jobInterval) {
    clearInterval(jobInterval);
    jobInterval = null;
    console.log('🛑 Limit orders job stopped');
  }
};

/**
 * Get job status information
 * @returns {object} Job status information
 */
export const getLimitOrdersJobStatus = (): object => {
  return {
    ...jobStatus,
    isActive: jobInterval !== null
  };
};

/**
 * Force run the limit orders job (for testing)
 */
export const forceRunLimitOrdersJob = async (): Promise<void> => {
  await runLimitOrdersJob();
}; 