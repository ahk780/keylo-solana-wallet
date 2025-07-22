import { Request, Response } from 'express';
import { User } from '../models/User';
import { Wallet } from '../models/Wallet';
import { Asset } from '../models/Asset';
import { Transaction } from '../models/Transaction';
import { transfer, SOL_MINT } from '../utils/transfer';
import { decryptPrivateKey } from '../utils/encryption';
import { ITransferRequest, IApiResponse } from '../types';

/**
 * Update asset balance after successful transfer
 * @param {string} userId - User ID
 * @param {string} mint - Token mint address
 * @param {number} amount - Amount transferred (to subtract from balance)
 */
const updateAssetBalance = async (userId: string, mint: string, amount: number): Promise<void> => {
  try {
    console.log(`💰 Updating asset balance after transfer: ${amount} of ${mint}`);

    // Find the user's asset for this mint
    const asset = await Asset.findOne({
      userId: userId,
      mint: mint,
      status: 'available'
    });

    if (!asset) {
      console.log(`⚠️ Asset not found for mint ${mint} (user: ${userId})`);
      return;
    }

    // Calculate new balance
    const newBalance = Math.max(0, asset.balance - amount);

    console.log(`📊 Asset balance update: ${asset.balance} → ${newBalance} ${asset.symbol}`);

    // Update balance using the asset method
    asset.updateBalance(newBalance);

    // Update sold totals for tracking
    asset.totalSold = (asset.totalSold || 0) + amount;

    // Check if asset should be marked as sold (effectively empty)
    if (asset.isEffectivelyEmpty()) {
      asset.status = 'sold';
      asset.lastSoldAt = new Date();
      console.log(`✅ Asset marked as SOLD: ${asset.symbol} (balance: ${newBalance})`);
    }

    await asset.save();
    console.log(`💾 Asset balance updated successfully for ${asset.symbol}`);

  } catch (error) {
    console.error(`❌ Error updating asset balance after transfer:`, error);
  }
};

/**
 * Transfer SOL or SPL tokens to another wallet
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 */
export const transferTokens = async (req: Request, res: Response): Promise<void> => {
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

    const { mint, amount, to }: ITransferRequest = req.body;

    // Validate input
    if (!mint || !amount || !to) {
      const response: IApiResponse = {
        success: false,
        message: 'Missing required parameters',
        error: 'mint, amount, and to are required'
      };
      res.status(400).json(response);
      return;
    }

    if (amount <= 0) {
      const response: IApiResponse = {
        success: false,
        message: 'Invalid amount',
        error: 'Amount must be greater than 0'
      };
      res.status(400).json(response);
      return;
    }

    // Get user and wallet
    const user = await User.findById(userId);
    if (!user) {
      const response: IApiResponse = {
        success: false,
        message: 'User not found',
        error: 'User not found'
      };
      res.status(404).json(response);
      return;
    }

    const wallet = await Wallet.findOne({ userId });
    if (!wallet) {
      const response: IApiResponse = {
        success: false,
        message: 'Wallet not found',
        error: 'User wallet not found'
      };
      res.status(404).json(response);
      return;
    }

    // Check if user is trying to send to their own wallet
    if (to === user.wallet) {
      const response: IApiResponse = {
        success: false,
        message: 'Invalid transfer',
        error: 'Cannot transfer to your own wallet'
      };
      res.status(400).json(response);
      return;
    }

    // Check if user has sufficient balance for non-SOL tokens
    if (mint !== SOL_MINT) {
      const asset = await Asset.findOne({ 
        userId: userId, 
        mint: mint, 
        status: 'available' 
      });

      if (!asset) {
        const response: IApiResponse = {
          success: false,
          message: 'Asset not found',
          error: 'You do not own this token or no balance available'
        };
        res.status(404).json(response);
        return;
      }

      if (asset.balance < amount) {
        const response: IApiResponse = {
          success: false,
          message: 'Insufficient balance',
          error: `Insufficient balance. Available: ${asset.balance} ${asset.symbol}, Required: ${amount}`
        };
        res.status(400).json(response);
        return;
      }
    }

    // Get environment variables
    const encryptionKey = process.env.ENCRYPTION_KEY;
    const rpcUrl = process.env.SOLANA_RPC_URL;
    
    if (!encryptionKey || !rpcUrl) {
      const response: IApiResponse = {
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
      const response: IApiResponse = {
        success: false,
        message: 'Failed to decrypt private key',
        error: 'Unable to access wallet'
      };
      res.status(500).json(response);
      return;
    }

    // Perform transfer
    const transferResult = await transfer(privateKey, to, mint, amount, rpcUrl);

    if (transferResult.success) {
      // Update asset balance immediately for non-SOL tokens
      if (mint !== SOL_MINT) {
        await updateAssetBalance(userId, mint, amount);
      }

      // Transaction will be automatically detected and stored by the monitoring service
      const response: IApiResponse = {
        success: true,
        message: 'Transfer completed successfully',
        data: {
          signature: transferResult.signature,
          from: user.wallet,
          to: to,
          mint: mint,
          amount: amount,
          status: 'confirmed',
          note: 'Asset balance updated immediately'
        }
      };
      res.status(200).json(response);
    } else {
      const response: IApiResponse = {
        success: false,
        message: 'Transfer failed',
        error: transferResult.error || 'Unknown error occurred'
      };
      res.status(400).json(response);
    }
  } catch (error) {
    console.error('Transfer error:', error);
    
    const response: IApiResponse = {
      success: false,
      message: 'Transfer failed',
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
    res.status(500).json(response);
  }
};

/**
 * Get user's transaction history
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 */
export const getTransactionHistory = async (req: Request, res: Response): Promise<void> => {
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

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    // Get transactions for user
    const rawTransactions = await Transaction.find({ userId })
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit);

    // Format transactions to avoid scientific notation
    const transactions = rawTransactions.map(tx => ({
      ...tx.toObject(),
      amount: parseFloat(tx.amount.toFixed(10)).toString().replace(/\.?0+$/, ''),
      value: parseFloat(tx.value.toFixed(10)).toString().replace(/\.?0+$/, '')
    }));

    const totalTransactions = await Transaction.countDocuments({ userId });
    const totalPages = Math.ceil(totalTransactions / limit);

    const response: IApiResponse = {
      success: true,
      message: 'Transaction history retrieved successfully',
      data: {
        transactions,
        pagination: {
          currentPage: page,
          totalPages,
          totalTransactions,
          limit
        }
      }
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('Get transaction history error:', error);
    
    const response: IApiResponse = {
      success: false,
      message: 'Failed to retrieve transaction history',
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
    res.status(500).json(response);
  }
}; 