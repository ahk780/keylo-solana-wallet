import { Router } from 'express';
import { authenticateToken, requireAdmin } from '../middleware/auth';
import { getTransactionMonitorJobStatus, syncAllUsers, restartTransactionMonitorJob } from '../jobs/transactionMonitorJob';
import { getTrendingJobStatus } from '../jobs/trendingTokensJob';
import { getSolPriceJobStatus, forceRefreshSolPrice } from '../jobs/solPriceJob';
import { getLimitOrdersJobStatus } from '../jobs/limitOrdersJob';
import { getAssetDiscoveryJob, stopAssetDiscoveryJob, startAssetDiscoveryJob } from '../jobs/assetDiscoveryJob';
import { stopSolPriceJob, startSolPriceJob } from '../jobs/solPriceJob';
import { stopLimitOrdersJob, startLimitOrdersJob } from '../jobs/limitOrdersJob';
import { stopTransactionMonitorJob, startTransactionMonitorJob } from '../jobs/transactionMonitorJob';
import { stopTokenCleanupJob, startTokenCleanupJob } from '../jobs/tokenCleanupJob';
import { User } from '../models/User';
import { Asset } from '../models/Asset';
import { Order } from '../models/Order';
import { Transaction } from '../models/Transaction';
import rateLimit from 'express-rate-limit';

const router = Router();

// Admin rate limiting - more restrictive
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // limit each IP to 50 admin requests per windowMs
  message: {
    success: false,
    message: 'Too many admin requests',
    error: 'Please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// All admin routes require authentication AND admin role
router.use(authenticateToken);
router.use(requireAdmin);
router.use(adminLimiter);

// ========== SYSTEM MANAGEMENT ==========

/**
 * GET /api/admin/system/status
 * Get comprehensive system status
 */
router.get('/system/status', (req, res) => {
  try {
    const systemStatus = {
      transactionMonitor: getTransactionMonitorJobStatus(),
      trendingTokens: getTrendingJobStatus(),
      solPrice: getSolPriceJobStatus(),
      limitOrders: getLimitOrdersJobStatus(),
      assetDiscovery: getAssetDiscoveryJob()?.getStats() || { status: 'not_running' }
    };

    return res.status(200).json({
      success: true,
      message: 'System status retrieved successfully',
      data: systemStatus
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to get system status',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/admin/system/transaction-monitor/restart
 * Restart transaction monitoring job
 */
router.post('/system/transaction-monitor/restart', async (req, res) => {
  try {
    await restartTransactionMonitorJob();
    return res.status(200).json({
      success: true,
      message: 'Transaction monitor restarted successfully by admin'
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to restart transaction monitor',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/admin/system/transaction-monitor/stop
 * Stop transaction monitoring job
 */
router.post('/system/transaction-monitor/stop', async (req, res) => {
  try {
    await stopTransactionMonitorJob();
    return res.status(200).json({
      success: true,
      message: 'Transaction monitor stopped successfully by admin'
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to stop transaction monitor',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/admin/system/transaction-monitor/start
 * Start transaction monitoring job
 */
router.post('/system/transaction-monitor/start', async (req, res) => {
  try {
    await startTransactionMonitorJob();
    return res.status(200).json({
      success: true,
      message: 'Transaction monitor started successfully by admin'
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to start transaction monitor',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/admin/system/sync-all-users
 * Sync all users' transaction history (heavy operation)
 */
router.post('/system/sync-all-users', async (req, res) => {
  try {
    const result = await syncAllUsers();
    return res.status(result.success ? 200 : 500).json({
      ...result,
      message: result.message + ' (Admin initiated)'
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to sync all users',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/admin/system/sol-price/refresh
 * Force refresh SOL price data
 */
router.post('/system/sol-price/refresh', async (req, res) => {
  try {
    const refreshedData = await forceRefreshSolPrice();
    
    if (!refreshedData) {
      return res.status(503).json({
        success: false,
        message: 'Failed to refresh SOL price data',
        error: 'Price refresh failed'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'SOL price data refreshed successfully by admin',
      data: refreshedData
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to refresh SOL price data',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/admin/system/sol-price/stop
 * Stop SOL price monitoring job
 */
router.post('/system/sol-price/stop', async (req, res) => {
  try {
    stopSolPriceJob();
    return res.status(200).json({
      success: true,
      message: 'SOL price monitoring stopped successfully by admin'
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to stop SOL price monitoring',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/admin/system/sol-price/start
 * Start SOL price monitoring job
 */
router.post('/system/sol-price/start', async (req, res) => {
  try {
    await startSolPriceJob();
    return res.status(200).json({
      success: true,
      message: 'SOL price monitoring started successfully by admin'
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to start SOL price monitoring',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/admin/system/asset-discovery/stop
 * Stop asset discovery job
 */
router.post('/system/asset-discovery/stop', (req, res) => {
  try {
    stopAssetDiscoveryJob();
    return res.status(200).json({
      success: true,
      message: 'Asset discovery job stopped successfully by admin'
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to stop asset discovery job',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/admin/system/asset-discovery/start
 * Start asset discovery job
 */
router.post('/system/asset-discovery/start', (req, res) => {
  try {
    startAssetDiscoveryJob();
    return res.status(200).json({
      success: true,
      message: 'Asset discovery job started successfully by admin'
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to start asset discovery job',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/admin/system/limit-orders/stop
 * Stop limit orders monitoring job
 */
router.post('/system/limit-orders/stop', (req, res) => {
  try {
    stopLimitOrdersJob();
    return res.status(200).json({
      success: true,
      message: 'Limit orders monitoring stopped successfully by admin'
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to stop limit orders monitoring',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/admin/system/limit-orders/start
 * Start limit orders monitoring job
 */
router.post('/system/limit-orders/start', (req, res) => {
  try {
    startLimitOrdersJob();
    return res.status(200).json({
      success: true,
      message: 'Limit orders monitoring started successfully by admin'
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to start limit orders monitoring',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/admin/system/token-cleanup/stop
 * Stop token cleanup job
 */
router.post('/system/token-cleanup/stop', (req, res) => {
  try {
    stopTokenCleanupJob();
    return res.status(200).json({
      success: true,
      message: 'Token cleanup job stopped successfully by admin'
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to stop token cleanup job',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/admin/system/token-cleanup/start
 * Start token cleanup job
 */
router.post('/system/token-cleanup/start', (req, res) => {
  try {
    startTokenCleanupJob();
    return res.status(200).json({
      success: true,
      message: 'Token cleanup job started successfully by admin'
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to start token cleanup job',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// ========== USER MANAGEMENT ==========

/**
 * GET /api/admin/users
 * Get all users with pagination
 */
router.get('/users', async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const [users, totalUsers] = await Promise.all([
      User.find()
        .select('-password')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      User.countDocuments()
    ]);

    return res.status(200).json({
      success: true,
      message: 'Users retrieved successfully',
      data: users,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalUsers / limit),
        totalUsers,
        limit
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve users',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * PUT /api/admin/users/:userId/status
 * Update user status (ban/unban)
 */
router.put('/users/:userId/status', async (req, res) => {
  try {
    const { userId } = req.params;
    const { status } = req.body;

    if (!['active', 'banned'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status',
        error: 'Status must be either "active" or "banned"'
      });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { status },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
        error: 'User does not exist'
      });
    }

    return res.status(200).json({
      success: true,
      message: `User ${status === 'banned' ? 'banned' : 'unbanned'} successfully`,
      data: user
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to update user status',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * PUT /api/admin/users/:userId/role
 * Update user role
 */
router.put('/users/:userId/role', async (req, res) => {
  try {
    const { userId } = req.params;
    const { role } = req.body;

    if (!['user', 'moderator', 'admin'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role',
        error: 'Role must be "user", "moderator", or "admin"'
      });
    }

    // Prevent demoting the last admin
    if (role !== 'admin') {
      const adminCount = await User.countDocuments({ role: 'admin' });
      const targetUser = await User.findById(userId);
      
      if (targetUser?.role === 'admin' && adminCount <= 1) {
        return res.status(400).json({
          success: false,
          message: 'Cannot demote last admin',
          error: 'There must be at least one admin user'
        });
      }
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { role },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
        error: 'User does not exist'
      });
    }

    return res.status(200).json({
      success: true,
      message: `User role updated to ${role} successfully`,
      data: user
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to update user role',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/admin/users/:userId
 * Get specific user details with full information
 */
router.get('/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId).select('-password');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
        error: 'User does not exist'
      });
    }

    // Get user's stats
    const [assetCount, orderCount, transactionCount] = await Promise.all([
      Asset.countDocuments({ userId }),
      Order.countDocuments({ userId }),
      Transaction.countDocuments({ userId })
    ]);

    return res.status(200).json({
      success: true,
      message: 'User details retrieved successfully',
      data: {
        user,
        stats: {
          assetCount,
          orderCount,
          transactionCount
        }
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve user details',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// ========== ANALYTICS & MONITORING ==========

/**
 * GET /api/admin/analytics/overview
 * Get system-wide analytics
 */
router.get('/analytics/overview', async (req, res) => {
  try {
    const [
      totalUsers,
      activeUsers,
      bannedUsers,
      totalAssets,
      totalOrders,
      totalTransactions,
      waitingOrders,
      triggeredOrders,
      failedOrders
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ status: 'active' }),
      User.countDocuments({ status: 'banned' }),
      Asset.countDocuments(),
      Order.countDocuments(),
      Transaction.countDocuments(),
      Order.countDocuments({ status: 'waiting' }),
      Order.countDocuments({ status: 'triggered' }),
      Order.countDocuments({ status: 'failed' })
    ]);

    const analytics = {
      users: {
        total: totalUsers,
        active: activeUsers,
        banned: bannedUsers
      },
      assets: {
        total: totalAssets
      },
      orders: {
        total: totalOrders,
        waiting: waitingOrders,
        triggered: triggeredOrders,
        failed: failedOrders
      },
      transactions: {
        total: totalTransactions
      }
    };

    return res.status(200).json({
      success: true,
      message: 'System analytics retrieved successfully',
      data: analytics
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve analytics',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/admin/analytics/transactions
 * Get detailed transaction analytics
 */
router.get('/analytics/transactions', async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const daysBack = parseInt(days as string);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    const transactionStats = await Transaction.aggregate([
      { 
        $match: { 
          created_at: { $gte: startDate } 
        } 
      },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          totalValue: { $sum: '$value' }
        }
      }
    ]);

    return res.status(200).json({
      success: true,
      message: `Transaction analytics for last ${daysBack} days retrieved successfully`,
      data: {
        period: `${daysBack} days`,
        stats: transactionStats
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve transaction analytics',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/admin/orders/all
 * Get all orders across all users (admin view)
 */
router.get('/orders/all', async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const [orders, totalOrders] = await Promise.all([
      Order.find()
        .populate('userId', 'name email wallet')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Order.countDocuments()
    ]);

    return res.status(200).json({
      success: true,
      message: 'All orders retrieved successfully',
      data: orders,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalOrders / limit),
        totalOrders,
        limit
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve orders',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// ========== EMERGENCY CONTROLS ==========

/**
 * POST /api/admin/emergency/stop-all-jobs
 * Emergency stop all background jobs
 */
router.post('/emergency/stop-all-jobs', async (req, res) => {
  try {
    // Stop all jobs
    stopAssetDiscoveryJob();
    stopSolPriceJob();
    stopLimitOrdersJob();
    await stopTransactionMonitorJob();
    stopTokenCleanupJob();

    return res.status(200).json({
      success: true,
      message: 'All background jobs stopped successfully (Emergency)'
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to stop all jobs',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/admin/emergency/start-all-jobs
 * Emergency start all background jobs
 */
router.post('/emergency/start-all-jobs', async (req, res) => {
  try {
    // Start all jobs
    startAssetDiscoveryJob();
    await startSolPriceJob();
    startLimitOrdersJob();
    await startTransactionMonitorJob();
    startTokenCleanupJob();

    return res.status(200).json({
      success: true,
      message: 'All background jobs started successfully (Emergency)'
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to start all jobs',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Health check endpoint
router.get('/health', (req, res) => {
  return res.status(200).json({
    success: true,
    message: 'Admin service is healthy',
    timestamp: new Date().toISOString()
  });
});

export default router; 