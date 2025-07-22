import { Request, Response, NextFunction } from 'express';
import { OTP } from '../models/OTP';

interface OTPRateLimitStore {
  [key: string]: {
    count: number;
    resetTime: number;
  };
}

// In-memory store for rate limiting (in production, use Redis)
const emailStore: OTPRateLimitStore = {};
const ipStore: OTPRateLimitStore = {};

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  
  Object.keys(emailStore).forEach(key => {
    if (emailStore[key].resetTime < now) {
      delete emailStore[key];
    }
  });
  
  Object.keys(ipStore).forEach(key => {
    if (ipStore[key].resetTime < now) {
      delete ipStore[key];
    }
  });
}, 5 * 60 * 1000);

export const otpRateLimit = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const email = req.body.email?.toLowerCase();
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    
    if (!email) {
      res.status(400).json({
        success: false,
        message: 'Email is required'
      });
      return;
    }

    const now = Date.now();
    const windowMs = 60 * 1000; // 1 minute
    const maxRequests = 3;

    // Check email rate limit
    if (emailStore[email]) {
      if (emailStore[email].resetTime > now) {
        if (emailStore[email].count >= maxRequests) {
          res.status(429).json({
            success: false,
            message: 'Too many OTP requests. Please wait before requesting again.',
            retryAfter: Math.ceil((emailStore[email].resetTime - now) / 1000)
          });
          return;
        }
        emailStore[email].count++;
      } else {
        emailStore[email] = { count: 1, resetTime: now + windowMs };
      }
    } else {
      emailStore[email] = { count: 1, resetTime: now + windowMs };
    }

    // Check IP rate limit
    if (ipStore[ip]) {
      if (ipStore[ip].resetTime > now) {
        if (ipStore[ip].count >= maxRequests) {
          res.status(429).json({
            success: false,
            message: 'Too many OTP requests from this IP. Please wait before requesting again.',
            retryAfter: Math.ceil((ipStore[ip].resetTime - now) / 1000)
          });
          return;
        }
        ipStore[ip].count++;
      } else {
        ipStore[ip] = { count: 1, resetTime: now + windowMs };
      }
    } else {
      ipStore[ip] = { count: 1, resetTime: now + windowMs };
    }

    // Also check database for recent OTPs (backup validation)
    const recentOTPs = await OTP.countDocuments({
      $or: [{ email }, { userIp: ip }],
      createdAt: { $gte: new Date(now - windowMs) }
    });

    if (recentOTPs >= maxRequests) {
      res.status(429).json({
        success: false,
        message: 'Too many OTP requests. Please wait before requesting again.',
        retryAfter: 60
      });
      return;
    }

    next();
  } catch (error) {
    console.error('Rate limit check failed:', error);
    next(); // Continue on error to not block requests
  }
}; 