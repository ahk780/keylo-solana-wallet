import express from 'express';
import { body } from 'express-validator';
import { requestOTP, verifyOTP } from '../controllers/otpController';
import { otpRateLimit } from '../middleware/otpRateLimit';

const router = express.Router();

// Validation middleware for request OTP
const validateRequestOTP = [
  body('type')
    .isIn(['login', 'register', 'withdraw', 'security'])
    .withMessage('Type must be one of: login, register, withdraw, security'),
  body('email')
    .isEmail()
    .withMessage('Please provide a valid email address')
    .normalizeEmail()
];

// Validation middleware for verify OTP
const validateVerifyOTP = [
  body('email')
    .isEmail()
    .withMessage('Please provide a valid email address')
    .normalizeEmail(),
  body('otp')
    .isLength({ min: 6, max: 6 })
    .withMessage('OTP must be exactly 6 characters')
    .isNumeric()
    .withMessage('OTP must be numeric'),
  body('type')
    .isIn(['login', 'register', 'withdraw', 'security'])
    .withMessage('Type must be one of: login, register, withdraw, security')
];

// Routes
router.post('/request', otpRateLimit, validateRequestOTP, requestOTP);
router.post('/verify', validateVerifyOTP, verifyOTP);

export default router; 