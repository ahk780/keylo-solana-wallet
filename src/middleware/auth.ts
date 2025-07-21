import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt';
import { User } from '../models/User';
import { InvalidatedToken } from '../models/InvalidatedToken';
import { IAuthPayload, IApiResponse } from '../types';

// Extend Express Request interface to include user
declare global {
  namespace Express {
    interface Request {
      user?: IAuthPayload;
    }
  }
}

/**
 * Authentication middleware to verify JWT tokens
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 * @param {NextFunction} next - Express next function
 */
export const authenticateToken = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      const response: IApiResponse = {
        success: false,
        message: 'Access token is required',
        error: 'No authorization header provided'
      };
      res.status(401).json(response);
      return;
    }

    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    
    if (!token) {
      const response: IApiResponse = {
        success: false,
        message: 'Access token is required',
        error: 'No token provided'
      };
      res.status(401).json(response);
      return;
    }

    // Verify token
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      const response: IApiResponse = {
        success: false,
        message: 'Server configuration error',
        error: 'JWT secret not configured'
      };
      res.status(500).json(response);
      return;
    }

    const decoded = verifyToken(token, jwtSecret);
    
    // Check if token has been invalidated (logged out)
    const isInvalidated = await (InvalidatedToken as any).isTokenInvalidated(token);
    if (isInvalidated) {
      const response: IApiResponse = {
        success: false,
        message: 'Token has been invalidated',
        error: 'Token has been logged out or invalidated'
      };
      res.status(401).json(response);
      return;
    }
    
    // Check if user still exists and is active
    const user = await User.findById(decoded.userId);
    if (!user) {
      const response: IApiResponse = {
        success: false,
        message: 'User not found',
        error: 'User associated with token no longer exists'
      };
      res.status(401).json(response);
      return;
    }

    if (user.status === 'banned') {
      const response: IApiResponse = {
        success: false,
        message: 'Account is banned',
        error: 'User account has been banned'
      };
      res.status(403).json(response);
      return;
    }

    // Attach user to request object
    req.user = decoded;
    next();
  } catch (error) {
    const response: IApiResponse = {
      success: false,
      message: 'Invalid or expired token',
      error: error instanceof Error ? error.message : 'Token verification failed'
    };
    res.status(401).json(response);
  }
};

/**
 * Authorization middleware to check user roles
 * @param {string[]} allowedRoles - Array of allowed roles
 * @returns {Function} Express middleware function
 */
export const authorizeRoles = (allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      if (!req.user) {
        const response: IApiResponse = {
          success: false,
          message: 'Authentication required',
          error: 'User not authenticated'
        };
        res.status(401).json(response);
        return;
      }

      if (!allowedRoles.includes(req.user.role)) {
        const response: IApiResponse = {
          success: false,
          message: 'Insufficient permissions',
          error: `Role '${req.user.role}' is not authorized for this action`
        };
        res.status(403).json(response);
        return;
      }

      next();
    } catch (error) {
      const response: IApiResponse = {
        success: false,
        message: 'Authorization failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
      res.status(500).json(response);
    }
  };
};

/**
 * Optional authentication middleware (doesn't fail if no token)
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 * @param {NextFunction} next - Express next function
 */
export const optionalAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      next();
      return;
    }

    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    
    if (!token) {
      next();
      return;
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      next();
      return;
    }

    try {
      const decoded = verifyToken(token, jwtSecret);
      
      // Check if token has been invalidated (optional auth, so we just skip if invalidated)
      const isInvalidated = await (InvalidatedToken as any).isTokenInvalidated(token);
      if (!isInvalidated) {
        // Check if user still exists and is active
        const user = await User.findById(decoded.userId);
        if (user && user.status === 'active') {
          req.user = decoded;
        }
      }
    } catch {
      // Ignore token verification errors for optional auth
    }

    next();
  } catch (error) {
    // For optional auth, we don't fail on errors
    next();
  }
}; 

/**
 * Admin-only authorization middleware
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 * @param {NextFunction} next - Express next function
 */
export const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
  try {
    if (!req.user) {
      const response: IApiResponse = {
        success: false,
        message: 'Authentication required',
        error: 'User not authenticated'
      };
      res.status(401).json(response);
      return;
    }

    if (req.user.role !== 'admin') {
      const response: IApiResponse = {
        success: false,
        message: 'Admin access required',
        error: 'This action requires administrator privileges'
      };
      res.status(403).json(response);
      return;
    }

    next();
  } catch (error) {
    const response: IApiResponse = {
      success: false,
      message: 'Authorization failed',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
    res.status(500).json(response);
  }
}; 