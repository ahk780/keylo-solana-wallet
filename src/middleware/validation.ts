import { Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import { IApiResponse } from '../types';

/**
 * Middleware to handle validation errors
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 * @param {NextFunction} next - Express next function
 */
export const handleValidationErrors = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    const response: IApiResponse = {
      success: false,
      message: 'Validation failed',
      error: errors.array().map(error => ({
        field: error.type === 'field' ? error.path : 'unknown',
        message: error.msg
      }))
    };
    res.status(400).json(response);
    return;
  }
  
  next();
};

/**
 * Validation rules for user registration
 */
export const validateRegister = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Name must be between 2 and 50 characters')
    .matches(/^[a-zA-Z\s]+$/)
    .withMessage('Name can only contain letters and spaces'),
  
  body('email')
    .trim()
    .isEmail()
    .withMessage('Please provide a valid email address')
    .normalizeEmail()
    .isLength({ max: 100 })
    .withMessage('Email cannot exceed 100 characters'),
  
  body('password')
    .isLength({ min: 8, max: 128 })
    .withMessage('Password must be between 8 and 128 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'),
  
  handleValidationErrors
];

/**
 * Validation rules for user login
 */
export const validateLogin = [
  body('email')
    .trim()
    .isEmail()
    .withMessage('Please provide a valid email address')
    .normalizeEmail(),
  
  body('password')
    .notEmpty()
    .withMessage('Password is required')
    .isLength({ min: 1 })
    .withMessage('Password cannot be empty'),
  
  handleValidationErrors
];

/**
 * Validation rules for password change
 */
export const validatePasswordChange = [
  body('currentPassword')
    .notEmpty()
    .withMessage('Current password is required'),
  
  body('newPassword')
    .isLength({ min: 8, max: 128 })
    .withMessage('New password must be between 8 and 128 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
    .withMessage('New password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'),
  
  body('confirmPassword')
    .custom((value, { req }) => {
      if (value !== req.body.newPassword) {
        throw new Error('Password confirmation does not match');
      }
      return true;
    }),
  
  handleValidationErrors
];

/**
 * Validation rules for profile update
 */
export const validateProfileUpdate = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Name must be between 2 and 50 characters')
    .matches(/^[a-zA-Z\s]+$/)
    .withMessage('Name can only contain letters and spaces'),
  
  body('email')
    .optional()
    .trim()
    .isEmail()
    .withMessage('Please provide a valid email address')
    .normalizeEmail()
    .isLength({ max: 100 })
    .withMessage('Email cannot exceed 100 characters'),
  
  handleValidationErrors
];

/**
 * Validation rules for transfer request
 */
export const validateTransfer = [
  body('mint')
    .trim()
    .isLength({ min: 32, max: 44 })
    .withMessage('Mint address must be a valid Solana address')
    .matches(/^[1-9A-HJ-NP-Za-km-z]+$/)
    .withMessage('Mint address must be a valid base58 string'),
  
  body('amount')
    .isFloat({ min: 0.000001 })
    .withMessage('Amount must be greater than 0'),
  
  body('to')
    .trim()
    .isLength({ min: 32, max: 44 })
    .withMessage('Destination address must be a valid Solana address')
    .matches(/^[1-9A-HJ-NP-Za-km-z]+$/)
    .withMessage('Destination address must be a valid base58 string'),
  
  handleValidationErrors
];

/**
 * Sanitize input data
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 * @param {NextFunction} next - Express next function
 */
export const sanitizeInput = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Remove any potential XSS attacks
  const sanitizeValue = (value: any): any => {
    if (typeof value === 'string') {
      return value
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<[^>]+>/g, '')
        .trim();
    }
    if (typeof value === 'object' && value !== null) {
      const sanitized: any = {};
      for (const key in value) {
        if (value.hasOwnProperty(key)) {
          sanitized[key] = sanitizeValue(value[key]);
        }
      }
      return sanitized;
    }
    return value;
  };

  req.body = sanitizeValue(req.body);
  req.query = sanitizeValue(req.query);
  req.params = sanitizeValue(req.params);

  next();
};

/**
 * Validation rules for creating limit orders
 */
export const validateCreateOrder = [
  body('mint')
    .trim()
    .isLength({ min: 32, max: 44 })
    .withMessage('Mint must be a valid Solana address (32-44 characters)')
    .matches(/^[1-9A-HJ-NP-Za-km-z]+$/)
    .withMessage('Mint must be a valid base58 string'),
  
  body('amount')
    .isNumeric()
    .withMessage('Amount must be a number')
    .isFloat({ min: 0.000001 })
    .withMessage('Amount must be greater than 0'),
  
  body('dex')
    .trim()
    .isIn(['raydium', 'meteora', 'pumpfun', 'launchlab', 'moonshot', 'jupiter'])
    .withMessage('Dex must be one of: raydium, meteora, pumpfun, launchlab, moonshot, jupiter'),
  
  body('order_type')
    .trim()
    .isIn(['high', 'low'])
    .withMessage('Order type must be either high or low'),
  
  body('trigger_price')
    .isNumeric()
    .withMessage('Trigger price must be a number')
    .isFloat({ min: 0.000001 })
    .withMessage('Trigger price must be greater than 0'),
  
  body('type')
    .trim()
    .isIn(['buy', 'sell'])
    .withMessage('Type must be either buy or sell'),
  
  handleValidationErrors
];

/**
 * Validation rules for updating limit orders
 */
export const validateUpdateOrder = [
  body('amount')
    .optional()
    .isNumeric()
    .withMessage('Amount must be a number')
    .isFloat({ min: 0.000001 })
    .withMessage('Amount must be greater than 0'),
  
  body('dex')
    .optional()
    .trim()
    .isIn(['raydium', 'meteora', 'pumpfun', 'launchlab', 'moonshot', 'jupiter'])
    .withMessage('Dex must be one of: raydium, meteora, pumpfun, launchlab, moonshot, jupiter'),
  
  body('order_type')
    .optional()
    .trim()
    .isIn(['high', 'low'])
    .withMessage('Order type must be either high or low'),
  
  body('trigger_price')
    .optional()
    .isNumeric()
    .withMessage('Trigger price must be a number')
    .isFloat({ min: 0.000001 })
    .withMessage('Trigger price must be greater than 0'),
  
  body('type')
    .optional()
    .trim()
    .isIn(['buy', 'sell'])
    .withMessage('Type must be either buy or sell'),
  
  handleValidationErrors
];

/**
 * Validation for token burn requests
 */
export const validateTokenBurn = [
  body('mint')
    .trim()
    .isLength({ min: 32, max: 44 })
    .withMessage('Mint address must be a valid Solana address')
    .matches(/^[1-9A-HJ-NP-Za-km-z]+$/)
    .withMessage('Mint address must be a valid base58 string'),
  
  body('amount')
    .isFloat({ gt: 0 })
    .withMessage('Amount must be greater than 0'),
  
  handleValidationErrors
];

/**
 * Validation for token close account requests
 */
export const validateTokenClose = [
  body('mint')
    .trim()
    .isLength({ min: 32, max: 44 })
    .withMessage('Mint address must be a valid Solana address')
    .matches(/^[1-9A-HJ-NP-Za-km-z]+$/)
    .withMessage('Mint address must be a valid base58 string'),
  
  handleValidationErrors
]; 