import jwt, { SignOptions } from 'jsonwebtoken';
import { IAuthPayload } from '../types';

/**
 * Generate a JWT token for user authentication
 * @param {IAuthPayload} payload - The payload to include in the token
 * @param {string} secret - The JWT secret from environment variables
 * @param {string} expiresIn - Token expiration time (default: '7d')
 * @returns {string} The generated JWT token
 */
export const generateToken = (
  payload: IAuthPayload,
  secret: string,
  expiresIn: string | number = '7d'
): string => {
  try {
    if (!payload || !secret) {
      throw new Error('Payload and secret are required');
    }

    const options: SignOptions = {
      expiresIn: expiresIn as any,
      issuer: 'solana-wallet-backend',
      audience: 'solana-wallet-frontend'
    };

    const token = jwt.sign(payload as object, secret, options);

    return token;
  } catch (error) {
    throw new Error(`Token generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

/**
 * Verify and decode a JWT token
 * @param {string} token - The JWT token to verify
 * @param {string} secret - The JWT secret from environment variables
 * @returns {IAuthPayload} The decoded payload
 */
export const verifyToken = (token: string, secret: string): IAuthPayload => {
  try {
    if (!token || !secret) {
      throw new Error('Token and secret are required');
    }

    // Remove 'Bearer ' prefix if present
    const cleanToken = token.startsWith('Bearer ') ? token.slice(7) : token;

    const decoded = jwt.verify(cleanToken, secret, {
      issuer: 'solana-wallet-backend',
      audience: 'solana-wallet-frontend'
    }) as IAuthPayload;

    return decoded;
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      throw new Error('Invalid token');
    }
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error('Token has expired');
    }
    if (error instanceof jwt.NotBeforeError) {
      throw new Error('Token not active yet');
    }
    throw new Error(`Token verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

/**
 * Decode a JWT token without verification (for debugging purposes)
 * @param {string} token - The JWT token to decode
 * @returns {any} The decoded payload
 */
export const decodeToken = (token: string): any => {
  try {
    if (!token) {
      throw new Error('Token is required');
    }

    // Remove 'Bearer ' prefix if present
    const cleanToken = token.startsWith('Bearer ') ? token.slice(7) : token;

    return jwt.decode(cleanToken);
  } catch (error) {
    throw new Error(`Token decode failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

/**
 * Check if a token is expired
 * @param {string} token - The JWT token to check
 * @returns {boolean} True if expired, false otherwise
 */
export const isTokenExpired = (token: string): boolean => {
  try {
    const decoded = decodeToken(token) as any;
    if (!decoded || !decoded.exp) {
      return true;
    }

    const currentTime = Math.floor(Date.now() / 1000);
    return decoded.exp < currentTime;
  } catch {
    return true;
  }
};

/**
 * Get token expiration time
 * @param {string} token - The JWT token
 * @returns {Date | null} The expiration date or null if invalid
 */
export const getTokenExpiration = (token: string): Date | null => {
  try {
    const decoded = decodeToken(token) as any;
    if (!decoded || !decoded.exp) {
      return null;
    }

    return new Date(decoded.exp * 1000);
  } catch {
    return null;
  }
}; 