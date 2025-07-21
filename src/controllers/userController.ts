import { Request, Response } from 'express';
import { Asset } from '../models/Asset';
import { Order } from '../models/Order';
import { Transaction } from '../models/Transaction';
import { User } from '../models/User';
import { getAssetDiscoveryJob } from '../jobs/assetDiscoveryJob';
import { getCachedSolPrice } from '../jobs/solPriceJob';
import { getSolanaBalance } from '../utils/solana';
import { IApiResponse } from '../types';

/**
 * Get user's assets (portfolio)
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 */
export const getUserAssets = async (req: Request, res: Response): Promise<void> => {
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
    const limit = parseInt(req.query.limit as string) || 20;
    const status = req.query.status as string || 'available';
    const skip = (page - 1) * limit;

    // Get user's assets
    const assets = await Asset.find({ userId, status })
      .sort({ currentValue: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const totalAssets = await Asset.countDocuments({ userId, status });
    const totalPages = Math.ceil(totalAssets / limit);

    // Calculate portfolio summary
    const portfolioSummary = await Asset.aggregate([
      { $match: { userId, status: 'available' } },
      {
        $group: {
          _id: null,
          totalValue: { $sum: '$currentValue' },
          totalAssets: { $sum: 1 },
          avgPrice: { $avg: '$currentPrice' }
        }
      }
    ]);

    const summary = portfolioSummary[0] || {
      totalValue: 0,
      totalAssets: 0,
      avgPrice: 0
    };

    const response: IApiResponse = {
      success: true,
      message: 'Assets retrieved successfully',
      data: {
        assets,
        summary: {
          totalValue: summary.totalValue,
          totalAssets: summary.totalAssets,
          averagePrice: summary.avgPrice
        },
        pagination: {
          currentPage: page,
          totalPages,
          totalAssets,
          limit
        }
      }
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('Get user assets error:', error);
    
    const response: IApiResponse = {
      success: false,
      message: 'Failed to retrieve assets',
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
    res.status(500).json(response);
  }
};

/**
 * Get specific asset by ID
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 */
export const getAssetById = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const assetId = req.params.assetId;
    
    if (!userId) {
      const response: IApiResponse = {
        success: false,
        message: 'Invalid session',
        error: 'User ID not found in token'
      };
      res.status(401).json(response);
      return;
    }

    const asset = await Asset.findOne({ _id: assetId, userId });
    
    if (!asset) {
      const response: IApiResponse = {
        success: false,
        message: 'Asset not found',
        error: 'Asset not found or does not belong to user'
      };
      res.status(404).json(response);
      return;
    }

    const response: IApiResponse = {
      success: true,
      message: 'Asset retrieved successfully',
      data: { asset }
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('Get asset by ID error:', error);
    
    const response: IApiResponse = {
      success: false,
      message: 'Failed to retrieve asset',
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
    res.status(500).json(response);
  }
};



/**
 * Get asset discovery job status
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 */
export const getAssetJobStatus = async (req: Request, res: Response): Promise<void> => {
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

    const job = getAssetDiscoveryJob();
    
    if (!job) {
      const response: IApiResponse = {
        success: true,
        message: 'Asset discovery job status',
        data: {
          status: 'not_running',
          isRunning: false
        }
      };
      res.status(200).json(response);
      return;
    }

    const stats = job.getStats();

    const response: IApiResponse = {
      success: true,
      message: 'Asset discovery job status',
      data: {
        status: 'running',
        ...stats
      }
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('Get asset job status error:', error);
    
    const response: IApiResponse = {
      success: false,
      message: 'Failed to get job status',
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
    res.status(500).json(response);
  }
}; 

/**
 * Get comprehensive dashboard statistics
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 */
export const getDashboardStats = async (req: Request, res: Response): Promise<void> => {
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

    // Get user info
    const user = await User.findById(userId);
    if (!user) {
      const response: IApiResponse = {
        success: false,
        message: 'User not found',
        error: 'User account not found'
      };
      res.status(404).json(response);
      return;
    }

    // Get RPC URL for SOL balance
    const rpcUrl = process.env.SOLANA_RPC_URL;
    if (!rpcUrl) {
      const response: IApiResponse = {
        success: false,
        message: 'Server configuration error',
        error: 'Solana RPC URL not configured'
      };
      res.status(500).json(response);
      return;
    }

    // Parallel data fetching for better performance
    const [
      portfolioStats,
      limitOrdersStats,
      transactionStats,
      userSolBalance,
      recentAssets,
      recentTransactions,
      recentOrders,
      topPerformers
    ] = await Promise.all([
      getPortfolioStats(userId),
      getLimitOrdersStats(userId),
      getTransactionStats(userId),
      getSolanaBalance(user.wallet, rpcUrl),
      getRecentAssets(userId),
      getRecentTransactions(userId),
      getRecentOrders(userId),
      getTopPerformingAssets(userId)
    ]);

    // Get current SOL price
    const solPriceData = getCachedSolPrice();
    const solPrice = solPriceData?.solPriceUsd || 0;

    // Calculate SOL value in USD
    const solValueUsd = userSolBalance * solPrice;

    // Prepare dashboard data - ENHANCED with new transaction structure
    const dashboardData = {
      // Account Information
      account: {
        walletAddress: user.wallet,
        memberSince: user.createdAt,
        accountStatus: user.status,
        userRole: user.role
      },

      // Portfolio Overview
      portfolio: {
        ...portfolioStats,
        solBalance: userSolBalance,
        solPrice: solPrice,
        solValueUsd: solValueUsd,
        totalPortfolioValue: portfolioStats.totalValue + solValueUsd
      },

      // Trading Activity - UPDATED for new transaction structure
      trading: {
        ...transactionStats,
        successRate: 100, // All stored transactions are successful in new structure
        // Most active transaction type
        mostActiveType: transactionStats.sendTransactions >= transactionStats.receiveTransactions && transactionStats.sendTransactions >= transactionStats.swapTransactions ? 'send' 
          : transactionStats.receiveTransactions >= transactionStats.swapTransactions ? 'receive' : 'swap'
      },

      // Limit Orders
      orders: {
        ...limitOrdersStats,
        averageOrderValue: limitOrdersStats.totalOrderValue / (limitOrdersStats.totalOrders || 1)
      },

      // Recent Activity - ENHANCED with transaction details
      recent: {
        assets: recentAssets,
        transactions: recentTransactions,
        orders: recentOrders,
        // Additional transaction insights
        lastTransactionTime: recentTransactions.length > 0 ? recentTransactions[0].created_at : null,
        recentVolume24h: await getRecentVolume24h(userId), // Get last 24h volume
        transactionBreakdown: {
          sends: transactionStats.sendTransactions,
          receives: transactionStats.receiveTransactions,
          swaps: transactionStats.swapTransactions
        }
      },

      // Performance
      performance: {
        topGainers: topPerformers.gainers,
        topLosers: topPerformers.losers,
        portfolioChangeToday: portfolioStats.portfolioChangeToday,
        portfolioChangePercent: portfolioStats.portfolioChangePercent
      },

      // System Status
      system: {
        solPrice: solPrice,
        priceLastUpdated: solPriceData?.lastUpdated || null,
        assetsLastScanned: await getLastAssetScanTime(userId)
      }
    };

    const response: IApiResponse = {
      success: true,
      message: 'Dashboard statistics retrieved successfully',
      data: dashboardData
    };

    res.status(200).json(response);

  } catch (error) {
    console.error('Error getting dashboard stats:', error);
    
    const response: IApiResponse = {
      success: false,
      message: 'Failed to retrieve dashboard statistics',
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
    res.status(500).json(response);
  }
};

/**
 * Get portfolio statistics
 */
const getPortfolioStats = async (userId: string): Promise<any> => {
  try {
    const assets = await Asset.find({ userId, status: 'available' });
    
    const portfolioSummary = await Asset.aggregate([
      { $match: { userId, status: 'available' } },
      {
        $group: {
          _id: null,
          totalValue: { $sum: '$currentValue' },
          totalAssets: { $sum: 1 },
          totalBalance: { $sum: '$balance' },
          totalPurchased: { $sum: '$totalPurchased' },
          totalSold: { $sum: '$totalSold' },
          avgCurrentPrice: { $avg: '$currentPrice' },
          avgBuyPrice: { $avg: '$buyPrice' }
        }
      }
    ]);

    const summary = portfolioSummary[0] || {
      totalValue: 0,
      totalAssets: 0,
      totalBalance: 0,
      totalPurchased: 0,
      totalSold: 0,
      avgCurrentPrice: 0,
      avgBuyPrice: 0
    };

    // Calculate profit/loss
    const totalInvested = assets.reduce((sum, asset) => sum + ((asset.buyPrice || 0) * asset.balance), 0);
    const totalProfitLoss = summary.totalValue - totalInvested;
    const profitLossPercent = totalInvested > 0 ? (totalProfitLoss / totalInvested) * 100 : 0;

    // Calculate today's change (simplified - you might want to store historical data)
    const portfolioChangeToday = 0; // Would need historical price data
    const portfolioChangePercent = 0; // Would need historical price data

    return {
      totalValue: summary.totalValue,
      totalAssets: summary.totalAssets,
      totalProfitLoss: totalProfitLoss,
      profitLossPercent: profitLossPercent,
      portfolioChangeToday: portfolioChangeToday,
      portfolioChangePercent: portfolioChangePercent,
      totalInvested: totalInvested,
      avgPortfolioPrice: summary.avgCurrentPrice
    };
  } catch (error) {
    console.error('Error getting portfolio stats:', error);
    return {
      totalValue: 0,
      totalAssets: 0,
      totalProfitLoss: 0,
      profitLossPercent: 0,
      portfolioChangeToday: 0,
      portfolioChangePercent: 0,
      totalInvested: 0,
      avgPortfolioPrice: 0
    };
  }
};

/**
 * Get limit orders statistics
 */
const getLimitOrdersStats = async (userId: string): Promise<any> => {
  try {
    const [orderCounts, orderValues] = await Promise.all([
      Order.aggregate([
        { $match: { userId } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]),
      Order.aggregate([
        { $match: { userId } },
        {
          $group: {
            _id: '$type',
            totalValue: { $sum: { $multiply: ['$amount', '$triggerPrice'] } },
            count: { $sum: 1 }
          }
        }
      ])
    ]);

    const statusStats = orderCounts.reduce((acc: any, item: any) => {
      acc[item._id] = item.count;
      return acc;
    }, {});

    const typeStats = orderValues.reduce((acc: any, item: any) => {
      acc[item._id] = { count: item.count, totalValue: item.totalValue };
      return acc;
    }, {});

    const totalOrders = orderCounts.reduce((sum: number, item: any) => sum + item.count, 0);
    const totalOrderValue = orderValues.reduce((sum: number, item: any) => sum + item.totalValue, 0);

    return {
      totalOrders: totalOrders,
      totalOrderValue: totalOrderValue,
      waitingOrders: statusStats.waiting || 0,
      triggeredOrders: statusStats.triggered || 0,
      failedOrders: statusStats.failed || 0,
      buyOrders: typeStats.buy?.count || 0,
      sellOrders: typeStats.sell?.count || 0,
      buyOrderValue: typeStats.buy?.totalValue || 0,
      sellOrderValue: typeStats.sell?.totalValue || 0
    };
  } catch (error) {
    console.error('Error getting limit orders stats:', error);
    return {
      totalOrders: 0,
      totalOrderValue: 0,
      waitingOrders: 0,
      triggeredOrders: 0,
      failedOrders: 0,
      buyOrders: 0,
      sellOrders: 0,
      buyOrderValue: 0,
      sellOrderValue: 0
    };
  }
};

/**
 * Get transaction statistics - UPDATED for new transaction structure
 */
const getTransactionStats = async (userId: string): Promise<any> => {
  try {
    // Get transaction stats with the new structure
    const transactionStats = await Transaction.aggregate([
      { $match: { userId } },
      {
        $group: {
          _id: '$type', // Group by transaction type: send, receive, swap
          count: { $sum: 1 },
          totalVolume: { $sum: '$value' } // Sum USD values
        }
      }
    ]);

    // Get overall stats
    const overallStats = await Transaction.aggregate([
      { $match: { userId } },
      {
        $group: {
          _id: null,
          totalTransactions: { $sum: 1 },
          totalVolume: { $sum: '$value' }, // USD volume
          totalAmount: { $sum: { $abs: '$amount' } }, // Absolute amounts (ignore +/-)
          avgTransactionValue: { $avg: '$value' }
        }
      }
    ]);

    const typeStats = transactionStats.reduce((acc: any, item: any) => {
      acc[item._id] = { count: item.count, volume: item.totalVolume };
      return acc;
    }, {});

    const overall = overallStats[0] || {
      totalTransactions: 0,
      totalVolume: 0,
      totalAmount: 0,
      avgTransactionValue: 0
    };

    // All transactions are confirmed in the new structure (failed ones aren't stored)
    return {
      totalTransactions: overall.totalTransactions,
      totalVolume: overall.totalVolume,
      avgTransactionValue: overall.avgTransactionValue,
      successfulTransactions: overall.totalTransactions, // All stored transactions are successful
      failedTransactions: 0, // Not stored in new structure
      pendingTransactions: 0, // Not stored in new structure
      sendTransactions: typeStats.send?.count || 0,
      receiveTransactions: typeStats.receive?.count || 0,
      swapTransactions: typeStats.swap?.count || 0,
      sendVolume: typeStats.send?.volume || 0,
      receiveVolume: typeStats.receive?.volume || 0,
      swapVolume: typeStats.swap?.volume || 0
    };
  } catch (error) {
    console.error('Error getting transaction stats:', error);
    return {
      totalTransactions: 0,
      totalVolume: 0,
      avgTransactionValue: 0,
      successfulTransactions: 0,
      failedTransactions: 0,
      pendingTransactions: 0,
      sendTransactions: 0,
      receiveTransactions: 0,
      swapTransactions: 0,
      sendVolume: 0,
      receiveVolume: 0,
      swapVolume: 0
    };
  }
};

/**
 * Get recent assets (last 10)
 */
const getRecentAssets = async (userId: string): Promise<any[]> => {
  try {
    return await Asset.find({ userId, status: 'available' })
      .sort({ createdAt: -1 })
      .limit(10)
      .select('mint name symbol logo balance currentPrice currentValue createdAt');
  } catch (error) {
    console.error('Error getting recent assets:', error);
    return [];
  }
};

/**
 * Get recent transactions (last 10) - UPDATED for new transaction structure
 */
const getRecentTransactions = async (userId: string): Promise<any[]> => {
  try {
    const rawTransactions = await Transaction.find({ userId })
      .sort({ created_at: -1 }) // Fixed field name
      .limit(10)
      .select('signature type dex mint amount value name symbol logo from to status created_at');
    
    // Format transactions to avoid scientific notation
    return rawTransactions.map(tx => ({
      ...tx.toObject(),
      amount: parseFloat(tx.amount.toFixed(10)).toString().replace(/\.?0+$/, ''),
      value: parseFloat(tx.value.toFixed(10)).toString().replace(/\.?0+$/, '')
    }));
  } catch (error) {
    console.error('Error getting recent transactions:', error);
    return [];
  }
};

/**
 * Get recent orders (last 10)
 */
const getRecentOrders = async (userId: string): Promise<any[]> => {
  try {
    return await Order.find({ userId })
      .sort({ createdAt: -1 })
      .limit(10)
      .select('mint name symbol logo amount dex orderType triggerPrice currentPrice type status createdAt');
  } catch (error) {
    console.error('Error getting recent orders:', error);
    return [];
  }
};

/**
 * Get top performing assets
 */
const getTopPerformingAssets = async (userId: string): Promise<any> => {
  try {
    const assets = await Asset.find({ userId, status: 'available' })
      .select('mint name symbol logo balance currentPrice buyPrice currentValue');

    const assetsWithPerformance = assets.map(asset => {
      const buyPrice = asset.buyPrice || 0;
      const profitLoss = (asset.currentPrice - buyPrice) * asset.balance;
      const profitLossPercent = buyPrice > 0 ? ((asset.currentPrice - buyPrice) / buyPrice) * 100 : 0;
      
      return {
        ...asset.toObject(),
        profitLoss,
        profitLossPercent
      };
    });

    // Sort by profit/loss percentage
    const gainers = assetsWithPerformance
      .filter(asset => asset.profitLossPercent > 0)
      .sort((a, b) => b.profitLossPercent - a.profitLossPercent)
      .slice(0, 5);

    const losers = assetsWithPerformance
      .filter(asset => asset.profitLossPercent < 0)
      .sort((a, b) => a.profitLossPercent - b.profitLossPercent)
      .slice(0, 5);

    return { gainers, losers };
  } catch (error) {
    console.error('Error getting top performing assets:', error);
    return { gainers: [], losers: [] };
  }
};

/**
 * Get last asset scan time
 */
const getLastAssetScanTime = async (userId: string): Promise<Date | null> => {
  try {
    const lastAsset = await Asset.findOne({ userId }).sort({ updatedAt: -1 });
    return lastAsset?.updatedAt || null;
  } catch (error) {
    console.error('Error getting last asset scan time:', error);
    return null;
  }
};

/**
 * Get recent volume in last 24 hours - NEW function for transaction insights
 */
const getRecentVolume24h = async (userId: string): Promise<number> => {
  try {
    const yesterday = new Date();
    yesterday.setHours(yesterday.getHours() - 24);

    const recentVolumeStats = await Transaction.aggregate([
      { 
        $match: { 
          userId,
          created_at: { $gte: yesterday }
        }
      },
      {
        $group: {
          _id: null,
          totalVolume24h: { $sum: '$value' }
        }
      }
    ]);

    return recentVolumeStats[0]?.totalVolume24h || 0;
  } catch (error) {
    console.error('Error getting recent volume 24h:', error);
    return 0;
  }
}; 