import { Request, Response } from 'express';
import axios from 'axios';
import { User } from '../models/User';
import { Wallet } from '../models/Wallet';
import { Asset } from '../models/Asset';
import { burnTokens, closeTokenAccount, getEmptyTokenAccounts, TokenOperationResult, EmptyTokenAccount } from '../utils/tokenOperations';
import { decryptPrivateKey } from '../utils/encryption';
import { SOL_MINT } from '../utils/transfer';
import { IApiResponse, ITokenOverviewResponse, ITokenOverview } from '../types';

interface BurnTokenRequest {
  mint: string;
  amount: number;
}

interface CloseTokenRequest {
  mint: string;
}

interface TokenOperationResponse extends IApiResponse {
  data?: {
    signature?: string;
    mint: string;
    amount?: string | number; // Allow both formatted string and number
    operation: 'burn' | 'close';
  };
}

interface EmptyAccountsResponse extends IApiResponse {
  data?: {
    emptyAccounts: EmptyTokenAccount[];
    totalAccounts: number;
    totalRentRecoverable: number;
  };
}

/**
 * Burn user's tokens
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 */
export const burnUserTokens = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    
    if (!userId) {
      const response: TokenOperationResponse = {
        success: false,
        message: 'Invalid session',
        error: 'User ID not found in token'
      };
      res.status(401).json(response);
      return;
    }

    const { mint, amount }: BurnTokenRequest = req.body;

    // Validate input
    if (!mint || amount === undefined || amount === null) {
      const response: TokenOperationResponse = {
        success: false,
        message: 'Missing required parameters',
        error: 'mint and amount are required'
      };
      res.status(400).json(response);
      return;
    }

    if (amount <= 0) {
      const response: TokenOperationResponse = {
        success: false,
        message: 'Invalid amount',
        error: 'Amount must be greater than 0'
      };
      res.status(400).json(response);
      return;
    }

    // Check if trying to burn native SOL
    if (mint === SOL_MINT) {
      const response: TokenOperationResponse = {
        success: false,
        message: 'Cannot burn native SOL',
        error: 'Users cannot burn or close native SOL tokens'
      };
      res.status(400).json(response);
      return;
    }

    // Get user and wallet
    const user = await User.findById(userId);
    if (!user) {
      const response: TokenOperationResponse = {
        success: false,
        message: 'User not found',
        error: 'User not found'
      };
      res.status(404).json(response);
      return;
    }

    const wallet = await Wallet.findOne({ userId });
    if (!wallet) {
      const response: TokenOperationResponse = {
        success: false,
        message: 'Wallet not found',
        error: 'User wallet not found'
      };
      res.status(404).json(response);
      return;
    }

    // Check if user has the asset and sufficient balance
    const asset = await Asset.findOne({ userId, mint, status: 'available' });
    if (!asset) {
      const response: TokenOperationResponse = {
        success: false,
        message: 'Asset not found',
        error: 'Token not found in your portfolio or no balance available'
      };
      res.status(404).json(response);
      return;
    }

    if (asset.balance < amount) {
      const response: TokenOperationResponse = {
        success: false,
        message: 'Insufficient balance',
        error: `Insufficient balance. Available: ${asset.balance}, Required: ${amount}`
      };
      res.status(400).json(response);
      return;
    }

    // Get environment variables
    const encryptionKey = process.env.ENCRYPTION_KEY;
    const rpcUrl = process.env.SOLANA_RPC_URL;
    
    if (!encryptionKey || !rpcUrl) {
      const response: TokenOperationResponse = {
        success: false,
        message: 'Server configuration error',
        error: 'Missing server configuration'
      };
      res.status(500).json(response);
      return;
    }

    // Decrypt private key
    let privateKey: string;
    try {
      privateKey = decryptPrivateKey(wallet.privateKey, encryptionKey);
    } catch (error) {
      const response: TokenOperationResponse = {
        success: false,
        message: 'Failed to decrypt private key',
        error: 'Unable to access wallet'
      };
      res.status(500).json(response);
      return;
    }

    // Perform burn operation
    const burnResult: TokenOperationResult = await burnTokens(privateKey, mint, amount, rpcUrl);

    if (burnResult.success) {
      // Update asset balance in database
      const newBalance = asset.balance - amount;
      
      if (newBalance <= 0) {
        // Mark asset as sold if balance becomes zero or negative
        asset.balance = 0;
        asset.status = 'sold';
        asset.lastSoldAt = new Date();
        asset.totalSold = (asset.totalSold || 0) + amount;
      } else {
        // Update balance
        asset.balance = newBalance;
        asset.totalSold = (asset.totalSold || 0) + amount;
      }
      
      await asset.save();

      // Format amount to avoid scientific notation in response
      const formattedAmount = amount.toFixed(10).replace(/\.?0+$/, '');
      
      const response: TokenOperationResponse = {
        success: true,
        message: `Successfully burned ${formattedAmount} ${asset.symbol} tokens`,
        data: {
          signature: burnResult.signature,
          mint: mint,
          amount: formattedAmount, // Use formatted string to avoid scientific notation
          operation: 'burn'
        }
      };
      res.status(200).json(response);
    } else {
      const response: TokenOperationResponse = {
        success: false,
        message: 'Burn operation failed',
        error: burnResult.error || 'Unknown error occurred'
      };
      res.status(400).json(response);
    }
  } catch (error) {
    console.error('Burn tokens error:', error);
    
    const response: TokenOperationResponse = {
      success: false,
      message: 'Burn operation failed',
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
    res.status(500).json(response);
  }
};

/**
 * Close user's empty token account
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 */
export const closeUserTokenAccount = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    
    if (!userId) {
      const response: TokenOperationResponse = {
        success: false,
        message: 'Invalid session',
        error: 'User ID not found in token'
      };
      res.status(401).json(response);
      return;
    }

    const { mint }: CloseTokenRequest = req.body;

    // Validate input
    if (!mint) {
      const response: TokenOperationResponse = {
        success: false,
        message: 'Missing required parameters',
        error: 'mint is required'
      };
      res.status(400).json(response);
      return;
    }

    // Check if trying to close native SOL account
    if (mint === SOL_MINT) {
      const response: TokenOperationResponse = {
        success: false,
        message: 'Cannot close native SOL account',
        error: 'Users cannot burn or close native SOL tokens'
      };
      res.status(400).json(response);
      return;
    }

    // Get user and wallet
    const user = await User.findById(userId);
    if (!user) {
      const response: TokenOperationResponse = {
        success: false,
        message: 'User not found',
        error: 'User not found'
      };
      res.status(404).json(response);
      return;
    }

    const wallet = await Wallet.findOne({ userId });
    if (!wallet) {
      const response: TokenOperationResponse = {
        success: false,
        message: 'Wallet not found',
        error: 'User wallet not found'
      };
      res.status(404).json(response);
      return;
    }

    // Get asset for potential cleanup after successful close
    const asset = await Asset.findOne({ userId, mint });

    // Note: We always use on-chain balance checking via closeTokenAccount function
    // Database balance is unreliable, especially for 'sold' assets or due to decimal/rent issues

    // Get environment variables
    const encryptionKey = process.env.ENCRYPTION_KEY;
    const rpcUrl = process.env.SOLANA_RPC_URL;
    
    if (!encryptionKey || !rpcUrl) {
      const response: TokenOperationResponse = {
        success: false,
        message: 'Server configuration error',
        error: 'Missing server configuration'
      };
      res.status(500).json(response);
      return;
    }

    // Decrypt private key
    let privateKey: string;
    try {
      privateKey = decryptPrivateKey(wallet.privateKey, encryptionKey);
    } catch (error) {
      const response: TokenOperationResponse = {
        success: false,
        message: 'Failed to decrypt private key',
        error: 'Unable to access wallet'
      };
      res.status(500).json(response);
      return;
    }

    // Perform close operation
    const closeResult: TokenOperationResult = await closeTokenAccount(privateKey, mint, rpcUrl);

    if (closeResult.success) {
      // Remove asset from database if it exists
      if (asset) {
        await Asset.findByIdAndDelete(asset._id);
      }

      const response: TokenOperationResponse = {
        success: true,
        message: 'Successfully closed token account and recovered rent',
        data: {
          signature: closeResult.signature,
          mint: mint,
          operation: 'close'
        }
      };
      res.status(200).json(response);
    } else {
      const response: TokenOperationResponse = {
        success: false,
        message: 'Close operation failed',
        error: closeResult.error || 'Unknown error occurred'
      };
      res.status(400).json(response);
    }
  } catch (error) {
    console.error('Close token account error:', error);
    
    const response: TokenOperationResponse = {
      success: false,
      message: 'Close operation failed',
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
    res.status(500).json(response);
  }
};

/**
 * Get all empty token accounts for the user
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 */
export const getUserEmptyTokenAccounts = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    
    if (!userId) {
      const response: EmptyAccountsResponse = {
        success: false,
        message: 'Invalid session',
        error: 'User ID not found in token'
      };
      res.status(401).json(response);
      return;
    }

    // Get user
    const user = await User.findById(userId);
    if (!user) {
      const response: EmptyAccountsResponse = {
        success: false,
        message: 'User not found',
        error: 'User not found'
      };
      res.status(404).json(response);
      return;
    }

    // Get environment variables
    const rpcUrl = process.env.SOLANA_RPC_URL;
    
    if (!rpcUrl) {
      const response: EmptyAccountsResponse = {
        success: false,
        message: 'Server configuration error',
        error: 'Missing RPC URL configuration'
      };
      res.status(500).json(response);
      return;
    }

    // Get empty token accounts
    const emptyAccounts: EmptyTokenAccount[] = await getEmptyTokenAccounts(user.wallet, rpcUrl);

    // Calculate total recoverable rent
    const totalRentRecoverable = emptyAccounts.reduce((sum, account) => sum + account.rent, 0);

    const response: EmptyAccountsResponse = {
      success: true,
      message: `Found ${emptyAccounts.length} empty token accounts`,
      data: {
        emptyAccounts: emptyAccounts,
        totalAccounts: emptyAccounts.length,
        totalRentRecoverable: totalRentRecoverable
      }
    };
    res.status(200).json(response);

  } catch (error) {
    console.error('Get empty token accounts error:', error);
    
    const response: EmptyAccountsResponse = {
      success: false,
      message: 'Failed to retrieve empty token accounts',
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
    res.status(500).json(response);
  }
};

/**
 * Get comprehensive token overview from Coinvera API
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 */
export const getTokenOverview = async (req: Request, res: Response): Promise<void> => {
  try {
    const { mint } = req.params;
    
    // Validate mint address
    if (!mint) {
      const response: ITokenOverviewResponse = {
        success: false,
        message: 'Missing token mint address',
        error: 'Token mint address is required'
      };
      res.status(400).json(response);
      return;
    }

    // Get API key from environment
    const apiKey = process.env.COINVERA_APIKEY;
    if (!apiKey) {
      const response: ITokenOverviewResponse = {
        success: false,
        message: 'Coinvera API key not configured',
        error: 'API key is required for token overview'
      };
      res.status(500).json(response);
      return;
    }

    try {
      // Fetch token overview from Coinvera API
      const coinveraResponse = await axios.get(`https://api.coinvera.io/api/v1/overview?ca=${mint}`, {
        headers: {
          'x-api-key': apiKey,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        timeout: 10000 // 10 second timeout
      });

      // Check if the response is successful
      if (coinveraResponse.status === 200 && coinveraResponse.data) {
        const response: ITokenOverviewResponse = {
          success: true,
          message: 'Token overview retrieved successfully',
          data: coinveraResponse.data as ITokenOverview
        };
        res.status(200).json(response);
      } else {
        const response: ITokenOverviewResponse = {
          success: false,
          message: 'Token overview not found',
          error: 'Token not found or invalid mint address'
        };
        res.status(404).json(response);
      }
    } catch (apiError: any) {
      console.error('Coinvera API error:', apiError);
      
      // Handle specific API errors
      if (apiError.response?.status === 404) {
        const response: ITokenOverviewResponse = {
          success: false,
          message: 'Token not found',
          error: 'Token not found in Coinvera database'
        };
        res.status(404).json(response);
      } else if (apiError.response?.status === 429) {
        const response: ITokenOverviewResponse = {
          success: false,
          message: 'Rate limit exceeded',
          error: 'Too many requests to Coinvera API. Please try again later.'
        };
        res.status(429).json(response);
      } else {
        const response: ITokenOverviewResponse = {
          success: false,
          message: 'Failed to fetch token overview',
          error: apiError.response?.data?.message || 'External API error'
        };
        res.status(500).json(response);
      }
    }
  } catch (error) {
    console.error('Token overview error:', error);
    
    const response: ITokenOverviewResponse = {
      success: false,
      message: 'Internal server error',
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
    res.status(500).json(response);
  }
}; 