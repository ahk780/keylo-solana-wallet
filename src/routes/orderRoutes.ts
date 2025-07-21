import { Router } from 'express';
import { createOrder, getOrders, updateOrder, deleteOrder, getOrderById } from '../controllers/orderController';
import { authenticateToken } from '../middleware/auth';
import { validateCreateOrder, validateUpdateOrder } from '../middleware/validation';
import { getLimitOrdersJobStatus } from '../jobs/limitOrdersJob';
import { IApiResponse } from '../types';
import rateLimit from 'express-rate-limit';

const router = Router();

// Rate limiting for order endpoints
const orderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    success: false,
    message: 'Too many order requests',
    error: 'Please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply authentication and rate limiting to all order routes
router.use(authenticateToken);
router.use(orderLimiter);

/**
 * POST /api/user/orders
 * Create a new limit order
 */
router.post('/', validateCreateOrder, createOrder);

/**
 * GET /api/user/orders
 * Get user's limit orders with pagination and filtering
 */
router.get('/', getOrders);

/**
 * GET /api/user/orders/status/job
 * Get limit orders job status
 */
router.get('/status/job', (req, res) => {
  try {
    const jobStatus = getLimitOrdersJobStatus();
    
    const response: IApiResponse = {
      success: true,
      message: 'Limit orders job status retrieved successfully',
      data: jobStatus
    };
    
    res.status(200).json(response);
  } catch (error) {
    console.error('Error retrieving limit orders job status:', error);
    
    const response: IApiResponse = {
      success: false,
      message: 'Failed to retrieve limit orders job status',
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
    
    res.status(500).json(response);
  }
});

/**
 * GET /api/user/orders/:id
 * Get a specific order by ID
 */
router.get('/:id', getOrderById);

/**
 * PUT /api/user/orders/:id
 * Update an existing limit order
 */
router.put('/:id', validateUpdateOrder, updateOrder);

/**
 * DELETE /api/user/orders/:id
 * Delete a limit order
 */
router.delete('/:id', deleteOrder);

export default router; 