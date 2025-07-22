import { Request, Response } from 'express';
import { validationResult } from 'express-validator';
import crypto from 'crypto';
import { User } from '../models/User';
import { OTP } from '../models/OTP';
import { emailService } from '../utils/emailService';
import { IApiResponse } from '../types';

// Generate 6-digit OTP
const generateOTP = (): string => {
  return crypto.randomInt(100000, 999999).toString();
};

// Get real IP address (considering proxies)
const getRealIP = (req: Request): string => {
  return (
    req.headers['x-forwarded-for'] as string ||
    req.headers['x-real-ip'] as string ||
    req.connection.remoteAddress ||
    req.socket.remoteAddress ||
    (req.connection as any)?.socket?.remoteAddress ||
    'unknown'
  ).split(',')[0].trim();
};

export const requestOTP = async (req: Request, res: Response): Promise<void> => {
  try {
    // Validate request
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({
        success: false,
        message: 'Validation failed',
        error: errors.array().map(err => ({
          field: err.type === 'field' ? err.path : 'unknown',
          message: err.msg
        }))
      } as IApiResponse);
      return;
    }

    const { type, email } = req.body;
    const userIp = getRealIP(req);

    // Validate type
    if (!['login', 'register', 'withdraw', 'security'].includes(type)) {
      res.status(400).json({
        success: false,
        message: 'Invalid OTP type. Must be one of: login, register, withdraw, security'
      } as IApiResponse);
      return;
    }

    // For non-register types, validate user exists and is active
    let userId: string | undefined;
    if (type !== 'register') {
      const existingUser = await User.findOne({ 
        email: email.toLowerCase(),
        status: 'active'
      });

      if (!existingUser) {
        res.status(404).json({
          success: false,
          message: 'User not found or account is not active'
        } as IApiResponse);
        return;
      }

      userId = existingUser._id.toString();
    } else {
      // For register type, check if user already exists
      const existingUser = await User.findOne({ 
        email: email.toLowerCase() 
      });

      if (existingUser) {
        res.status(400).json({
          success: false,
          message: 'User with this email already exists'
        } as IApiResponse);
        return;
      }
    }

    // Check for recent pending OTPs
    const existingPendingOTP = await OTP.findOne({
      email: email.toLowerCase(),
      type,
      status: 'pending',
      createdAt: { $gte: new Date(Date.now() - 60 * 1000) } // Within last minute
    });

    if (existingPendingOTP) {
      res.status(429).json({
        success: false,
        message: 'Please wait before requesting a new OTP. Check your email for the existing OTP.',
        retryAfter: 60
      } as IApiResponse);
      return;
    }

    // Mark any existing pending OTPs for this email and type as expired
    await OTP.updateMany(
      {
        email: email.toLowerCase(),
        type,
        status: 'pending'
      },
      { status: 'expired' }
    );

    // Generate new OTP
    const otpCode = generateOTP();

    // Create OTP record
    const newOTP = new OTP({
      userId,
      email: email.toLowerCase(),
      otp: otpCode,
      userIp,
      type,
      status: 'pending'
    });

    await newOTP.save();

    // Send OTP email
    const emailSent = await emailService.sendOTPEmail({
      email: email.toLowerCase(),
      otp: otpCode,
      type
    });

    if (!emailSent) {
      // If email fails, mark OTP as expired
      await OTP.findByIdAndUpdate(newOTP._id, { status: 'expired' });
      
      res.status(500).json({
        success: false,
        message: 'Failed to send OTP email. Please try again.'
      } as IApiResponse);
      return;
    }

    console.log(`OTP ${otpCode} generated for ${email} (${type}) from IP: ${userIp}`);

    res.status(200).json({
      success: true,
      message: 'OTP sent successfully. Please check your email.',
      data: {
        email: email.toLowerCase(),
        type,
        expiresIn: '5 minutes'
      }
    } as IApiResponse);

  } catch (error) {
    console.error('Request OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: 'Failed to process OTP request'
    } as IApiResponse);
  }
};

export const verifyOTP = async (req: Request, res: Response): Promise<void> => {
  try {
    // Validate request
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({
        success: false,
        message: 'Validation failed',
        error: errors.array().map(err => ({
          field: err.type === 'field' ? err.path : 'unknown',
          message: err.msg
        }))
      } as IApiResponse);
      return;
    }

    const { email, otp, type } = req.body;
    const userIp = getRealIP(req);

    // Find valid OTP
    const otpRecord = await OTP.findOne({
      email: email.toLowerCase(),
      otp,
      type,
      status: 'pending',
      createdAt: { $gte: new Date(Date.now() - 5 * 60 * 1000) } // Within last 5 minutes
    });

    if (!otpRecord) {
      res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP'
      } as IApiResponse);
      return;
    }

    // Mark OTP as used
    await OTP.findByIdAndUpdate(otpRecord._id, { 
      status: 'used',
      userIp // Update with verification IP
    });

    console.log(`OTP verified successfully for ${email} (${type}) from IP: ${userIp}`);

    res.status(200).json({
      success: true,
      message: 'OTP verified successfully',
      data: {
        email: email.toLowerCase(),
        type,
        verified: true
      }
    } as IApiResponse);

  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: 'Failed to verify OTP'
    } as IApiResponse);
  }
}; 