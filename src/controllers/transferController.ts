import { Request, Response } from 'express';
import { User } from '../models/User';
import { Wallet } from '../models/Wallet';
import { Transaction } from '../models/Transaction';
import { transfer } from '../utils/transfer';
import { decryptPrivateKey } from '../utils/encryption';
import { ITransferRequest, IApiResponse } from '../types';

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
          note: 'Transaction details will be automatically tracked by the monitoring service'
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