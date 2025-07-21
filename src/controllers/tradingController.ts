import { Request, Response } from 'express';
import { Keypair, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import fetch from 'node-fetch';
import { ITradingRequest, ITradingResponse, IApiResponse, ISolanaPortalRequest, ICoinveraPriceResponse, ITrendingRequest, ICoinveraTrendingResponse, ICoinveraTrendingToken, ITrendingTokenData } from '../types';
import { fetchTokenPrice } from '../utils/priceUtils';
import { Asset } from '../models/Asset';
import { Wallet } from '../models/Wallet';
import { decryptPrivateKey } from '../utils/encryption';
import { getCachedTrendingTokens, isTrendingCacheStale } from '../utils/trendingService';

const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const SOLANA_PORTAL_API = 'https://api.solanaportal.io/api/trading';
const JITO_API = 'https://tokyo.mainnet.block-engine.jito.wtf/api/v1/transactions';
// Environment variables accessed directly to avoid module loading issues

/**
 * Execute token trade (buy/sell) using SolanaPortal API
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 */
export const executeTrade = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    
    if (!userId) {
      const response: IApiResponse = {
        success: false,
        message: 'Invalid session',
        error: 'User ID not found in token'
      };
      res.status(401).json(response);
      return;
    }

    // Validate environment variables
    if (!process.env.ENCRYPTION_KEY) {
      const response: IApiResponse = {
        success: false,
        message: 'Server configuration error',
        error: 'ENCRYPTION_KEY environment variable is not set'
      };
      res.status(500).json(response);
      return;
    }

    if (!process.env.COINVERA_APIKEY) {
      const response: IApiResponse = {
        success: false,
        message: 'Server configuration error',
        error: 'COINVERA_APIKEY environment variable is not set'
      };
      res.status(500).json(response);
      return;
    }

    const { mint, amount, dex, tip, slippage, type }: ITradingRequest = req.body;

    // Validate required fields
    if (!mint || !amount || !dex || tip === undefined || slippage === undefined || !type) {
      const response: IApiResponse = {
        success: false,
        message: 'Missing required fields',
        error: 'All fields (mint, amount, dex, tip, slippage, type) are required'
      };
      res.status(400).json(response);
      return;
    }

    // Validate dex
    const supportedDexes = ['raydium', 'meteora', 'pumpfun', 'launchlab', 'moonshot', 'jupiter'];
    if (!supportedDexes.includes(dex)) {
      const response: IApiResponse = {
        success: false,
        message: 'Invalid DEX',
        error: `DEX must be one of: ${supportedDexes.join(', ')}`
      };
      res.status(400).json(response);
      return;
    }

    // Validate type
    if (type !== 'buy' && type !== 'sell') {
      const response: IApiResponse = {
        success: false,
        message: 'Invalid type',
        error: 'Type must be either "buy" or "sell"'
      };
      res.status(400).json(response);
      return;
    }

    // Get user's wallet
    const userWallet = await Wallet.findOne({ userId });
    if (!userWallet) {
      const response: IApiResponse = {
        success: false,
        message: 'Wallet not found',
        error: 'User wallet not found'
      };
      res.status(404).json(response);
      return;
    }

    // Decrypt private key
    let privateKey: string;
    try {
      privateKey = decryptPrivateKey(userWallet.privateKey, process.env.ENCRYPTION_KEY!);
    } catch (error) {
      const response: IApiResponse = {
        success: false,
        message: 'Wallet decryption failed',
        error: 'Unable to decrypt wallet private key'
      };
      res.status(500).json(response);
      return;
    }

    // Create wallet from private key
    let wallet: Keypair;
    try {
      wallet = Keypair.fromSecretKey(bs58.decode(privateKey));
    } catch (error) {
      const response: IApiResponse = {
        success: false,
        message: 'Invalid private key',
        error: 'Unable to create wallet from private key'
      };
      res.status(500).json(response);
      return;
    }

    // Get current token price
    let tokenPrice = 0;
    try {
      const priceData = await fetchTokenPrice(mint, process.env.COINVERA_APIKEY!);
      tokenPrice = parseFloat(priceData.priceInUsd || '0');
    } catch (error) {
      console.error('Error fetching token price:', error);
    }

    // Prepare SolanaPortal API request
    const portalRequest: ISolanaPortalRequest = {
      wallet_address: wallet.publicKey.toBase58(),
      action: type,
      dex,
      mint,
      amount,
      slippage,
      tip,
      type: 'jito'
    };

    // Call SolanaPortal API
    const portalResponse = await fetch(SOLANA_PORTAL_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(portalRequest)
    });

    if (!portalResponse.ok) {
      const errorText = await portalResponse.text();
      console.error('SolanaPortal API Error:', errorText);
      const response: IApiResponse = {
        success: false,
        message: 'Trading API failed',
        error: `SolanaPortal API error: ${portalResponse.status} ${portalResponse.statusText}`
      };
      res.status(500).json(response);
      return;
    }

    // Get unsigned transaction
    const transactionData = await portalResponse.json() as string;
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
      const response: IApiResponse = {
        success: false,
        message: 'Transaction submission failed',
        error: `Jito API error: ${jitoResponse.status} ${jitoResponse.statusText}`
      };
      res.status(500).json(response);
      return;
    }

    const jitoResult = await jitoResponse.json() as any;
    
    if (!jitoResult.result) {
      const response: IApiResponse = {
        success: false,
        message: 'Transaction failed',
        error: 'No transaction signature received'
      };
      res.status(500).json(response);
      return;
    }

    const signature = jitoResult.result as string;
    const txUrl = `https://solscan.io/tx/${signature}`;

    // If buying, monitor for asset updates and track purchase
    if (type === 'buy' && tokenPrice > 0) {
      monitorAssetUpdate(userId, mint, tokenPrice, amount);
    }

    // If selling, update soldAt with sell price
    if (type === 'sell') {
      const asset = await Asset.findOne({ userId, mint });
      if (asset) {
        // Check if this is a full sale (balance becomes actually zero)
        const remainingBalance = asset.balance - amount;
        const isFullSale = remainingBalance <= 0; // Only consider as sold when balance is actually 0
        
        await Asset.findOneAndUpdate(
          { userId, mint },
          { 
            soldAt: tokenPrice,
            status: isFullSale ? 'sold' : 'available', // Only mark as sold if balance is effectively zero
            lastSoldAt: new Date(), // Track when last sale occurred
            $inc: { totalSold: amount } // Track total sold amount
          }
        );
      }
    }

    const response: ITradingResponse = {
      success: true,
      message: `${type.charAt(0).toUpperCase() + type.slice(1)} order executed successfully`,
      data: {
        signature,
        txUrl,
        price: tokenPrice,
        amount,
        type
      }
    };

    res.status(200).json(response);

  } catch (error) {
    console.error('Trading error:', error);
    
    const response: IApiResponse = {
      success: false,
      message: 'Trading operation failed',
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
    res.status(500).json(response);
  }
};

/**
 * Monitor asset updates after buying a token
 * @param {string} userId - User ID
 * @param {string} mint - Token mint address
 * @param {number} buyPrice - Price when token was bought
 * @param {number} amount - Amount purchased
 */
const monitorAssetUpdate = async (userId: string, mint: string, buyPrice: number, amount: number): Promise<void> => {
  const maxAttempts = 60; // Check for 5 minutes (every 5 seconds)
  let attempts = 0;

  const checkAsset = async (): Promise<void> => {
    try {
      const asset = await Asset.findOne({ userId, mint });
      
      if (asset) {
        // Asset found, update buy price and track purchase
        await Asset.findOneAndUpdate(
          { userId, mint },
          { 
            buyPrice,
            $inc: { totalPurchased: amount }, // Track total purchased amount
            status: 'available' // Ensure status is available after purchase
          }
        );
        return;
      }

      // Continue monitoring if asset not found and we haven't exceeded max attempts
      attempts++;
      if (attempts < maxAttempts) {
        setTimeout(checkAsset, 5000); // Check again in 5 seconds
      }
    } catch (error) {
      console.error('Error monitoring asset update:', error);
    }
  };

  // Start monitoring
  setTimeout(checkAsset, 5000); // Wait 5 seconds before first check
};

/**
 * Get trending tokens from cache
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 */
export const getTrendingTokens = async (req: Request, res: Response): Promise<void> => {
  try {
    const { hour, limit } = req.query as { hour?: string; limit?: string };

    // Validate hour parameter - set default to 24 if not provided
    let hourNumber = 24;
    if (hour) {
      hourNumber = parseInt(hour);
      const validHours = [1, 6, 12, 24];
      if (isNaN(hourNumber) || !validHours.includes(hourNumber)) {
        const response: IApiResponse = {
          success: false,
          message: 'Invalid hour parameter',
          error: `Hour must be one of: ${validHours.join(', ')}`
        };
        res.status(400).json(response);
        return;
      }
    }

    // Validate limit parameter - always use default limit of 20
    let limitNumber = 20;
    if (limit) {
      const parsedLimit = parseInt(limit);
      if (!isNaN(parsedLimit) && parsedLimit !== 20) {
        const response: IApiResponse = {
          success: false,
          message: 'Invalid limit parameter',
          error: `Limit is fixed at 20 tokens`
        };
        res.status(400).json(response);
        return;
      }
    }

    // Get cached trending tokens
    const cachedTokens = getCachedTrendingTokens(hourNumber);
    
    // Check if cache is empty or stale
    if (cachedTokens.length === 0) {
      const response: IApiResponse<ITrendingTokenData[]> = {
        success: true,
        message: `No trending tokens available for ${hourNumber}h period. Cache is being updated.`,
        data: []
      };
      res.status(200).json(response);
      return;
    }

    // Add cache metadata to response
    const isStale = isTrendingCacheStale(hourNumber);
    const response: IApiResponse<ITrendingTokenData[]> = {
      success: true,
      message: `Trending tokens retrieved from cache for ${hourNumber}h period${isStale ? ' (cache updating)' : ''}`,
      data: cachedTokens
    };

    res.status(200).json(response);

  } catch (error) {
    console.error('Error retrieving trending tokens from cache:', error);
    
    const response: IApiResponse = {
      success: false,
      message: 'Failed to retrieve trending tokens',
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
    res.status(500).json(response);
  }
}; 