import { Router } from 'express';
import { getBalance } from '../controllers/authController';
import { transferTokens, getTransactionHistory } from '../controllers/transferController';
import { getUserAssets, getAssetById, getAssetJobStatus, getDashboardStats } from '../controllers/userController';
import { executeTrade, getTrendingTokens } from '../controllers/tradingController';
import { authenticateToken } from '../middleware/auth';
import { validateTransfer, sanitizeInput } from '../middleware/validation';
import { getTrendingJobStatus } from '../jobs/trendingTokensJob';
import { getTransactionMonitorJobStatus } from '../jobs/transactionMonitorJob';
import rateLimit from 'express-rate-limit';

const router = Router();

// Rate limiting for user endpoints
const userLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    success: false,
    message: 'Too many requests',
    error: 'Please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// All user routes require authentication
router.use(authenticateToken);

// User endpoints
router.get('/balance', userLimiter, getBalance);
router.post('/transfer', userLimiter, sanitizeInput, validateTransfer, transferTokens);
router.get('/transactions', userLimiter, getTransactionHistory);
router.get('/dashboard', userLimiter, getDashboardStats);

// Asset endpoints
router.get('/assets', userLimiter, getUserAssets);
router.get('/assets/:assetId', userLimiter, getAssetById);
router.get('/assets-job/status', userLimiter, getAssetJobStatus);

// Trading endpoints
router.post('/trade', userLimiter, executeTrade);
router.get('/trending', userLimiter, getTrendingTokens);

// Trending job status endpoint
router.get('/trending/status', userLimiter, (req, res) => {
  const status = getTrendingJobStatus();
  res.status(200).json({
    success: true,
    message: 'Trending tokens job status',
    data: status
  });
});

// Fast RPC transaction monitor status endpoint
router.get('/transaction-monitor/status', userLimiter, (req, res) => {
  try {
    const status = getTransactionMonitorJobStatus();
    res.status(200).json({
      success: true,
      message: 'Fast RPC transaction monitor status',
      data: status
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get transaction monitor status',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// 🚨 ADMIN FUNCTIONS MOVED TO /api/admin/system/ routes
// These system-level operations are now restricted to admin users only

// Health check endpoint for user service
router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'User service is healthy',
    timestamp: new Date().toISOString()
  });
});

export default router; 