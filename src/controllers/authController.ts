import { Request, Response } from 'express';
import { User } from '../models/User';
import { Wallet } from '../models/Wallet';
import { InvalidatedToken } from '../models/InvalidatedToken';
import { generateSolanaWallet, getSolanaBalance } from '../utils/solana';
import { encryptPrivateKey } from '../utils/encryption';
import { generateToken, verifyToken } from '../utils/jwt';
import { IRegisterRequest, ILoginRequest, IAuthResponse, IApiResponse } from '../types';

/**
 * Register a new user
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 */
export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, password }: IRegisterRequest = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      const response: IApiResponse = {
        success: false,
        message: 'User already exists',
        error: 'A user with this email address already exists'
      };
      res.status(400).json(response);
      return;
    }

    // Generate Solana wallet
    const walletKeys = generateSolanaWallet();
    
    // Get encryption key from environment
    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey) {
      const response: IApiResponse = {
        success: false,
        message: 'Server configuration error',
        error: 'Encryption key not configured'
      };
      res.status(500).json(response);
      return;
    }

    // Encrypt private key
    const encryptedPrivateKey = encryptPrivateKey(walletKeys.privateKey, encryptionKey);

    // Create user
    const user = new User({
      name,
      email,
      password,
      wallet: walletKeys.publicKey,
      role: 'user',
      status: 'active'
    });

    await user.save();

    // Create wallet record
    const wallet = new Wallet({
      privateKey: encryptedPrivateKey,
      publicKey: walletKeys.publicKey,
      userId: user._id
    });

    await wallet.save();

    // Generate JWT token
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

    const tokenPayload = {
      userId: user._id,
      email: user.email,
      role: user.role
    };

    const token = generateToken(tokenPayload, jwtSecret, process.env.JWT_EXPIRES_IN || '7d');

    const response: IAuthResponse = {
      success: true,
      message: 'User registered successfully',
      data: {
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          wallet: user.wallet,
          role: user.role,
          status: user.status,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt
        } as any,
        token
      }
    };

    res.status(201).json(response);
  } catch (error) {
    console.error('Registration error:', error);
    const response: IApiResponse = {
      success: false,
      message: 'Registration failed',
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
    res.status(500).json(response);
  }
};

/**
 * Login user
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 */
export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password }: ILoginRequest = req.body;

    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      const response: IApiResponse = {
        success: false,
        message: 'Invalid credentials',
        error: 'Email or password is incorrect'
      };
      res.status(401).json(response);
      return;
    }

    // Check if user is active
    if (user.status === 'banned') {
      const response: IApiResponse = {
        success: false,
        message: 'Account is banned',
        error: 'Your account has been banned. Please contact support.'
      };
      res.status(403).json(response);
      return;
    }

    // Verify password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      const response: IApiResponse = {
        success: false,
        message: 'Invalid credentials',
        error: 'Email or password is incorrect'
      };
      res.status(401).json(response);
      return;
    }

    // Generate JWT token
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

    const tokenPayload = {
      userId: user._id,
      email: user.email,
      role: user.role
    };

    const token = generateToken(tokenPayload, jwtSecret, process.env.JWT_EXPIRES_IN || '7d');

    const response: IAuthResponse = {
      success: true,
      message: 'Login successful',
      data: {
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          wallet: user.wallet,
          role: user.role,
          status: user.status,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt
        } as any,
        token
      }
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('Login error:', error);
    const response: IApiResponse = {
      success: false,
      message: 'Login failed',
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
    res.status(500).json(response);
  }
};

/**
 * Validate user session
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 */
export const validateSession = async (req: Request, res: Response): Promise<void> => {
  try {
    // User is already authenticated by middleware
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

    // Get user details
    const user = await User.findById(userId);
    if (!user) {
      const response: IApiResponse = {
        success: false,
        message: 'User not found',
        error: 'User associated with session no longer exists'
      };
      res.status(401).json(response);
      return;
    }

    const response: IApiResponse = {
      success: true,
      message: 'Session is valid',
      data: {
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          wallet: user.wallet,
          role: user.role,
          status: user.status,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt
        }
      }
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('Session validation error:', error);
    const response: IApiResponse = {
      success: false,
      message: 'Session validation failed',
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
    res.status(500).json(response);
  }
};

/**
 * Get user profile
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 */
export const getProfile = async (req: Request, res: Response): Promise<void> => {
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

    const user = await User.findById(userId);
    if (!user) {
      const response: IApiResponse = {
        success: false,
        message: 'User not found',
        error: 'User not found'
      };
      res.status(404).json(response);
      return;
    }

    const response: IApiResponse = {
      success: true,
      message: 'Profile retrieved successfully',
      data: {
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          wallet: user.wallet,
          role: user.role,
          status: user.status,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt
        }
      }
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('Get profile error:', error);
    const response: IApiResponse = {
      success: false,
      message: 'Failed to retrieve profile',
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
    res.status(500).json(response);
  }
};

/**
 * Get user's Solana balance
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 */
export const getBalance = async (req: Request, res: Response): Promise<void> => {
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

    const user = await User.findById(userId);
    if (!user) {
      const response: IApiResponse = {
        success: false,
        message: 'User not found',
        error: 'User not found'
      };
      res.status(404).json(response);
      return;
    }

    // Get RPC URL from environment
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

    // Fetch balance using the user's wallet address
    const balance = await getSolanaBalance(user.wallet, rpcUrl);

    const response: IApiResponse = {
      success: true,
      message: 'Balance retrieved successfully',
      data: {
        balance: balance,
        walletAddress: user.wallet,
        unit: 'SOL'
      }
    };

    res.status(200).json(response);
  } catch (error) {
    console.error('Get balance error:', error);
    const response: IApiResponse = {
      success: false,
      message: 'Failed to retrieve balance',
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
    res.status(500).json(response);
  }
};

/**
 * Logout user and invalidate token
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 */
export const logout = async (req: Request, res: Response): Promise<void> => {
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

    // Verify token to get user info and expiration
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

    let decoded;
    try {
      decoded = verifyToken(token, jwtSecret);
    } catch (error) {
      const response: IApiResponse = {
        success: false,
        message: 'Invalid token',
        error: 'Token verification failed'
      };
      res.status(401).json(response);
      return;
    }

    // Check if token is already invalidated
    const isAlreadyInvalidated = await (InvalidatedToken as any).isTokenInvalidated(token);
    if (isAlreadyInvalidated) {
      const response: IApiResponse = {
        success: false,
        message: 'Token already invalidated',
        error: 'Token has already been logged out'
      };
      res.status(400).json(response);
      return;
    }

    // Calculate token expiration date
    if (!decoded.exp) {
      const response: IApiResponse = {
        success: false,
        message: 'Invalid token',
        error: 'Token does not have an expiration date'
      };
      res.status(401).json(response);
      return;
    }
    const expiresAt = new Date(decoded.exp * 1000); // JWT exp is in seconds

    // Invalidate the token
    await (InvalidatedToken as any).invalidateToken(token, decoded.userId, expiresAt, 'logout');

    // Trigger cleanup of old tokens (older than 8 days)
    const cleanedCount = await (InvalidatedToken as any).cleanupOldTokens();
    
    const response: IApiResponse = {
      success: true,
      message: 'Logout successful',
      data: {
        loggedOut: true,
        tokenInvalidated: true,
        cleanedOldSessions: cleanedCount
      }
    };
    res.status(200).json(response);

  } catch (error) {
    console.error('Logout error:', error);
    
    const response: IApiResponse = {
      success: false,
      message: 'Logout failed',
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
    res.status(500).json(response);
  }
}; 