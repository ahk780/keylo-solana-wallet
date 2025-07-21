import { Request, Response } from 'express';
import { Order } from '../models/Order';
import { Asset } from '../models/Asset';
import { User } from '../models/User';
import { ICreateOrderRequest, IUpdateOrderRequest, IOrderResponse, IAuthPayload } from '../types';
import { getTokenMetadata } from '../utils/tokenMetadata';
import { fetchTokenPrice, extractUsdPrice } from '../utils/priceUtils';
import { getCachedSolPrice } from '../jobs/solPriceJob';
import { SOL_MINT } from '../utils/transfer';
import { Connection, PublicKey } from '@solana/web3.js';

/**
 * Get user's SOL balance
 * @param {string} walletAddress - User's wallet address
 * @returns {Promise<number>} SOL balance or 0 if error
 */
const getUserSolBalance = async (walletAddress: string): Promise<number> => {
  try {
    const rpcUrl = process.env.SOLANA_RPC_URL;
    if (!rpcUrl) {
      console.error('SOLANA_RPC_URL not configured');
      return 0;
    }

    const connection = new Connection(rpcUrl, 'confirmed');
    const publicKey = new PublicKey(walletAddress);
    const balance = await connection.getBalance(publicKey);
    
    // Convert from lamports to SOL
    return balance / 1000000000;
  } catch (error) {
    console.error('Error fetching SOL balance:', error);
    return 0;
  }
};

/**
 * Create a new limit order
 */
export const createOrder = async (req: Request, res: Response): Promise<void> => {
  try {
    const { mint, amount, dex, order_type, trigger_price, slippage, tip, type } = req.body as ICreateOrderRequest;
    const user = req.user as IAuthPayload;

    // Validate required fields
    if (!mint || !amount || !dex || !order_type || !trigger_price || slippage === undefined || tip === undefined || !type) {
      const response: IOrderResponse = {
        success: false,
        message: 'Missing required fields',
        error: 'mint, amount, dex, order_type, trigger_price, slippage, tip, and type are required'
      };
      res.status(400).json(response);
      return;
    }

    // Validate amount
    if (amount <= 0) {
      const response: IOrderResponse = {
        success: false,
        message: 'Invalid amount',
        error: 'Amount must be greater than 0'
      };
      res.status(400).json(response);
      return;
    }

    // Validate trigger price
    if (trigger_price <= 0) {
      const response: IOrderResponse = {
        success: false,
        message: 'Invalid trigger price',
        error: 'Trigger price must be greater than 0'
      };
      res.status(400).json(response);
      return;
    }

    // Validate slippage (0-100%)
    if (slippage < 0 || slippage > 100) {
      const response: IOrderResponse = {
        success: false,
        message: 'Invalid slippage',
        error: 'Slippage must be between 0 and 100'
      };
      res.status(400).json(response);
      return;
    }

    // Validate tip
    if (tip < 0) {
      const response: IOrderResponse = {
        success: false,
        message: 'Invalid tip',
        error: 'Tip must be greater than or equal to 0'
      };
      res.status(400).json(response);
      return;
    }

    // For sell orders, check if user has enough balance
    if (type === 'sell') {
      // Special handling for native SOL - check actual wallet balance
      if (mint === SOL_MINT) {
        // Get user's wallet address
        const fullUser = await User.findById(user.userId);
        if (!fullUser) {
          const response: IOrderResponse = {
            success: false,
            message: 'User not found',
            error: 'User account not found'
          };
          res.status(404).json(response);
          return;
        }

        // Check actual SOL balance from wallet
        const solBalance = await getUserSolBalance(fullUser.wallet);
        
        if (solBalance < amount) {
          const response: IOrderResponse = {
            success: false,
            message: 'Insufficient SOL balance',
            error: `You only have ${solBalance.toFixed(4)} SOL available`
          };
          res.status(400).json(response);
          return;
        }
      } else {
        // For other tokens, check assets collection
        const userAsset = await Asset.findOne({
          userId: user.userId,
          mint: mint,
          status: 'available'
        });

        if (!userAsset) {
          const response: IOrderResponse = {
            success: false,
            message: 'Insufficient assets',
            error: 'You do not own this token'
          };
          res.status(400).json(response);
          return;
        }

        if (userAsset.balance < amount) {
          const response: IOrderResponse = {
            success: false,
            message: 'Insufficient balance',
            error: `You only have ${userAsset.balance} ${userAsset.symbol} available`
          };
          res.status(400).json(response);
          return;
        }
      }
    }

    // For SOL buy orders, check if user has enough USDT/USDC balance
    if (type === 'buy' && mint === SOL_MINT) {
      const requiredAmount = amount * trigger_price; // Calculate required USD amount
      
      // Check USDT and USDC balances
      const [usdtAsset, usdcAsset] = await Promise.all([
        Asset.findOne({
          userId: user.userId,
          mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
          status: 'available'
        }),
        Asset.findOne({
          userId: user.userId,
          mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          status: 'available'
        })
      ]);

      const usdtBalance = usdtAsset ? usdtAsset.balance : 0;
      const usdcBalance = usdcAsset ? usdcAsset.balance : 0;

      // Check if user has sufficient balance in either asset
      const hasEnoughUSDT = usdtBalance >= requiredAmount;
      const hasEnoughUSDC = usdcBalance >= requiredAmount;

      if (!hasEnoughUSDT && !hasEnoughUSDC) {
        const response: IOrderResponse = {
          success: false,
          message: 'Insufficient balance for SOL purchase',
          error: `You need $${requiredAmount.toFixed(2)} worth of USDT or USDC. You have: USDT: ${usdtBalance.toFixed(2)}, USDC: ${usdcBalance.toFixed(2)}`
        };
        res.status(400).json(response);
        return;
      }
    }

    // Get token metadata and current price
    let tokenName: string;
    let tokenSymbol: string;
    let tokenLogo: string;
    let currentPrice: number;

    // Special handling for SOL mint
    if (mint === SOL_MINT) {
      tokenName = 'Solana';
      tokenSymbol = 'SOL';
      tokenLogo = 'https://i.ibb.co/PsgjwHss/solana-sol-logo.png';
      
      // Get SOL price from cache
      const cachedSolPrice = getCachedSolPrice();
      if (!cachedSolPrice) {
        const response: IOrderResponse = {
          success: false,
          message: 'SOL price not available',
          error: 'SOL price data is not available at the moment'
        };
        res.status(503).json(response);
        return;
      }
      currentPrice = cachedSolPrice.solPriceUsd;
    } else {
      // Get environment variables
      const rpcUrl = process.env.SOLANA_RPC_URL;
      const apiKey = process.env.COINVERA_APIKEY;

      if (!rpcUrl || !apiKey) {
        const response: IOrderResponse = {
          success: false,
          message: 'Service configuration error',
          error: 'Service is not properly configured'
        };
        res.status(503).json(response);
        return;
      }

      // Fetch metadata and price simultaneously
      const [metadata, priceResponse] = await Promise.all([
        getTokenMetadata(mint, rpcUrl),
        fetchTokenPrice(mint, apiKey)
      ]);

      tokenName = metadata.name;
      tokenSymbol = metadata.symbol;
      tokenLogo = metadata.logo;
      currentPrice = extractUsdPrice(priceResponse);
    }

    // Create the order
    const order = new Order({
      userId: user.userId,
      mint,
      name: tokenName,
      symbol: tokenSymbol,
      logo: tokenLogo,
      amount,
      dex,
      orderType: order_type,
      triggerPrice: trigger_price,
      currentPrice,
      slippage,
      tip,
      type,
      signature: null,
      status: 'waiting'
    });

    await order.save();

    const response: IOrderResponse = {
      success: true,
      message: 'Limit order created successfully',
      data: order
    };

    res.status(201).json(response);
  } catch (error) {
    console.error('Error creating order:', error);
    
    const response: IOrderResponse = {
      success: false,
      message: 'Failed to create order',
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
    
    res.status(500).json(response);
  }
};

/**
 * Get user's limit orders
 */
export const getOrders = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user as IAuthPayload;
    const { page = 1, limit = 20, status, type } = req.query;

    const pageNum = parseInt(page as string) || 1;
    const limitNum = parseInt(limit as string) || 20;
    const skip = (pageNum - 1) * limitNum;

    // Build query filter
    const filter: any = { userId: user.userId };
    
    if (status && typeof status === 'string') {
      filter.status = status;
    }
    
    if (type && typeof type === 'string') {
      filter.type = type;
    }

    // Get orders with pagination
    const [orders, totalCount] = await Promise.all([
      Order.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Order.countDocuments(filter)
    ]);

    const response: IOrderResponse = {
      success: true,
      message: 'Orders retrieved successfully',
      data: orders
    };

    res.status(200).json({
      ...response,
      pagination: {
        currentPage: pageNum,
        totalPages: Math.ceil(totalCount / limitNum),
        totalOrders: totalCount,
        limit: limitNum
      }
    });
  } catch (error) {
    console.error('Error getting orders:', error);
    
    const response: IOrderResponse = {
      success: false,
      message: 'Failed to retrieve orders',
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
    
    res.status(500).json(response);
  }
};

/**
 * Update an existing limit order
 */
export const updateOrder = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const user = req.user as IAuthPayload;
    const updates = req.body as IUpdateOrderRequest;

    // Find the order
    const order = await Order.findOne({ _id: id, userId: user.userId });

    if (!order) {
      const response: IOrderResponse = {
        success: false,
        message: 'Order not found',
        error: 'Order not found or you do not have permission to update it'
      };
      res.status(404).json(response);
      return;
    }

    // Only allow updates to waiting orders
    if (order.status !== 'waiting') {
      const response: IOrderResponse = {
        success: false,
        message: 'Cannot update order',
        error: 'Only waiting orders can be updated'
      };
      res.status(400).json(response);
      return;
    }

    // Validate updates
    if (updates.amount && updates.amount <= 0) {
      const response: IOrderResponse = {
        success: false,
        message: 'Invalid amount',
        error: 'Amount must be greater than 0'
      };
      res.status(400).json(response);
      return;
    }

    if (updates.trigger_price && updates.trigger_price <= 0) {
      const response: IOrderResponse = {
        success: false,
        message: 'Invalid trigger price',
        error: 'Trigger price must be greater than 0'
      };
      res.status(400).json(response);
      return;
    }

    if (updates.slippage !== undefined && (updates.slippage < 0 || updates.slippage > 100)) {
      const response: IOrderResponse = {
        success: false,
        message: 'Invalid slippage',
        error: 'Slippage must be between 0 and 100'
      };
      res.status(400).json(response);
      return;
    }

    if (updates.tip !== undefined && updates.tip < 0) {
      const response: IOrderResponse = {
        success: false,
        message: 'Invalid tip',
        error: 'Tip must be greater than or equal to 0'
      };
      res.status(400).json(response);
      return;
    }

    // If updating to sell order or updating amount on sell order, check balance
    if ((updates.type === 'sell' || (order.type === 'sell' && updates.amount)) && 
        (updates.type === 'sell' || order.type === 'sell')) {
      const checkAmount = updates.amount || order.amount;
      
      // Special handling for native SOL - check actual wallet balance
      if (order.mint === SOL_MINT) {
        // Get user's wallet address
        const fullUser = await User.findById(user.userId);
        if (!fullUser) {
          const response: IOrderResponse = {
            success: false,
            message: 'User not found',
            error: 'User account not found'
          };
          res.status(404).json(response);
          return;
        }

        // Check actual SOL balance from wallet
        const solBalance = await getUserSolBalance(fullUser.wallet);
        
        if (solBalance < checkAmount) {
          const response: IOrderResponse = {
            success: false,
            message: 'Insufficient SOL balance',
            error: `You only have ${solBalance.toFixed(4)} SOL available`
          };
          res.status(400).json(response);
          return;
        }
      } else {
        // For other tokens, check assets collection
        const userAsset = await Asset.findOne({
          userId: user.userId,
          mint: order.mint,
          status: 'available'
        });

        if (!userAsset) {
          const response: IOrderResponse = {
            success: false,
            message: 'Insufficient assets',
            error: 'You do not own this token'
          };
          res.status(400).json(response);
          return;
        }

        if (userAsset.balance < checkAmount) {
          const response: IOrderResponse = {
            success: false,
            message: 'Insufficient balance',
            error: `You only have ${userAsset.balance} ${userAsset.symbol} available`
          };
          res.status(400).json(response);
          return;
        }
      }
    }

    // If updating SOL buy order, check USDT/USDC balance
    if ((updates.type === 'buy' || (order.type === 'buy' && (updates.amount || updates.trigger_price))) && 
        (updates.type === 'buy' || order.type === 'buy') && 
        order.mint === SOL_MINT) {
      const checkAmount = updates.amount || order.amount;
      const checkTriggerPrice = updates.trigger_price || order.triggerPrice;
      const requiredAmount = checkAmount * checkTriggerPrice;
      
      // Check USDT and USDC balances
      const [usdtAsset, usdcAsset] = await Promise.all([
        Asset.findOne({
          userId: user.userId,
          mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
          status: 'available'
        }),
        Asset.findOne({
          userId: user.userId,
          mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          status: 'available'
        })
      ]);

      const usdtBalance = usdtAsset ? usdtAsset.balance : 0;
      const usdcBalance = usdcAsset ? usdcAsset.balance : 0;

      // Check if user has sufficient balance in either asset
      const hasEnoughUSDT = usdtBalance >= requiredAmount;
      const hasEnoughUSDC = usdcBalance >= requiredAmount;

      if (!hasEnoughUSDT && !hasEnoughUSDC) {
        const response: IOrderResponse = {
          success: false,
          message: 'Insufficient balance for SOL purchase',
          error: `You need $${requiredAmount.toFixed(2)} worth of USDT or USDC. You have: USDT: ${usdtBalance.toFixed(2)}, USDC: ${usdcBalance.toFixed(2)}`
        };
        res.status(400).json(response);
        return;
      }
    }

    // Update the order
    if (updates.amount) order.amount = updates.amount;
    if (updates.dex) order.dex = updates.dex;
    if (updates.order_type) order.orderType = updates.order_type;
    if (updates.trigger_price) order.triggerPrice = updates.trigger_price;
    if (updates.slippage !== undefined) order.slippage = updates.slippage;
    if (updates.tip !== undefined) order.tip = updates.tip;
    if (updates.type) order.type = updates.type;

    await order.save();

    const response: IOrderResponse = {
      success: true,
      message: 'Order updated successfully',
      data: order
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('Error updating order:', error);
    
    const response: IOrderResponse = {
      success: false,
      message: 'Failed to update order',
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
    
    res.status(500).json(response);
  }
};

/**
 * Delete a limit order
 */
export const deleteOrder = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const user = req.user as IAuthPayload;

    // Find and delete the order
    const order = await Order.findOneAndDelete({ _id: id, userId: user.userId });

    if (!order) {
      const response: IOrderResponse = {
        success: false,
        message: 'Order not found',
        error: 'Order not found or you do not have permission to delete it'
      };
      res.status(404).json(response);
      return;
    }

    // Only allow deletion of waiting orders
    if (order.status !== 'waiting') {
      // Restore the order since we shouldn't delete it
      await order.save();
      
      const response: IOrderResponse = {
        success: false,
        message: 'Cannot delete order',
        error: 'Only waiting orders can be deleted'
      };
      res.status(400).json(response);
      return;
    }

    const response: IOrderResponse = {
      success: true,
      message: 'Order deleted successfully',
      data: order
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('Error deleting order:', error);
    
    const response: IOrderResponse = {
      success: false,
      message: 'Failed to delete order',
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
    
    res.status(500).json(response);
  }
};

/**
 * Get a single order by ID
 */
export const getOrderById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const user = req.user as IAuthPayload;

    const order = await Order.findOne({ _id: id, userId: user.userId });

    if (!order) {
      const response: IOrderResponse = {
        success: false,
        message: 'Order not found',
        error: 'Order not found or you do not have permission to view it'
      };
      res.status(404).json(response);
      return;
    }

    const response: IOrderResponse = {
      success: true,
      message: 'Order retrieved successfully',
      data: order
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('Error getting order:', error);
    
    const response: IOrderResponse = {
      success: false,
      message: 'Failed to retrieve order',
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
    
    res.status(500).json(response);
  }
}; 