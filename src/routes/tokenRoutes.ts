import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticateToken } from '../middleware/auth';
import { validateTokenBurn, validateTokenClose, sanitizeInput } from '../middleware/validation';
import { burnUserTokens, closeUserTokenAccount, getUserEmptyTokenAccounts, getTokenOverview } from '../controllers/tokenController';

const router = Router();

// Rate limiting for token operations
const tokenOperationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // limit each IP to 20 token operations per windowMs
  message: {
    success: false,
    message: 'Too many token operations',
    error: 'Please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const tokenQueryLimiter = rateLimit({
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

// Burn tokens endpoint
router.post('/burn', 
  tokenOperationLimiter, 
  authenticateToken, 
  sanitizeInput, 
  validateTokenBurn, 
  burnUserTokens
);

// Close token account endpoint
router.post('/close', 
  tokenOperationLimiter, 
  authenticateToken, 
  sanitizeInput, 
  validateTokenClose, 
  closeUserTokenAccount
);

// Get empty token accounts endpoint
router.get('/empty-accounts', 
  tokenQueryLimiter, 
  authenticateToken, 
  getUserEmptyTokenAccounts
);

// Get token overview from Coinvera API
router.get('/overview/:mint', 
  tokenQueryLimiter,
  getTokenOverview
);

// Health check endpoint
router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Token operations service is healthy',
    timestamp: new Date().toISOString()
  });
});

export default router; 