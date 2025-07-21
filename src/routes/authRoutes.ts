import { Router } from 'express';
import { register, login, validateSession, getProfile, logout } from '../controllers/authController';
import { validateRegister, validateLogin, sanitizeInput } from '../middleware/validation';
import { authenticateToken } from '../middleware/auth';
import rateLimit from 'express-rate-limit';

const router = Router();

// Rate limiting for authentication endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 requests per windowMs
  message: {
    success: false,
    message: 'Too many authentication attempts',
    error: 'Please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const generalLimiter = rateLimit({
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

// Public routes
router.post('/register', authLimiter, sanitizeInput, validateRegister, register);
router.post('/login', authLimiter, sanitizeInput, validateLogin, login);

// Protected routes
router.get('/validate-session', generalLimiter, authenticateToken, validateSession);
router.get('/profile', generalLimiter, authenticateToken, getProfile);
router.post('/logout', generalLimiter, logout); // No authenticateToken needed since we extract token manually

// Health check endpoint
router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Auth service is healthy',
    timestamp: new Date().toISOString()
  });
});

export default router; 