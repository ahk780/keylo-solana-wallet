import mongoose, { Schema } from 'mongoose';
import { IOTP } from '../types';

const otpSchema = new Schema<IOTP>(
  {
    userId: {
      type: String,
      required: false, // Optional for register type
      ref: 'User'
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      trim: true,
      lowercase: true,
      match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email']
    },
    otp: {
      type: String,
      required: [true, 'OTP is required'],
      minlength: [6, 'OTP must be 6 characters long'],
      maxlength: [6, 'OTP must be 6 characters long']
    },
    userIp: {
      type: String,
      required: [true, 'User IP is required'],
      trim: true
    },
    type: {
      type: String,
      enum: ['login', 'register', 'withdraw', 'security'],
      required: [true, 'OTP type is required']
    },
    status: {
      type: String,
      enum: ['pending', 'used', 'expired'],
      default: 'pending'
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

// Add TTL index for automatic expiration after 5 minutes
otpSchema.index({ createdAt: 1 }, { expireAfterSeconds: 300 });

// Add compound index for efficient queries
otpSchema.index({ email: 1, type: 1, status: 1 });
otpSchema.index({ userIp: 1, createdAt: 1 });

export const OTP = mongoose.model<IOTP>('OTP', otpSchema); 