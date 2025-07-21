import mongoose, { Schema } from 'mongoose';
import { IAsset } from '../types';

const assetSchema = new Schema<IAsset>(
  {
    userId: {
      type: String,
      required: [true, 'User ID is required'],
      ref: 'User',
      index: true
    },
    mint: {
      type: String,
      required: [true, 'Mint address is required'],
      trim: true,
      index: true
    },
    tokenAccount: {
      type: String,
      required: [true, 'Token account address is required'],
      trim: true,
      unique: true
    },
    name: {
      type: String,
      required: [true, 'Token name is required'],
      trim: true
    },
    symbol: {
      type: String,
      required: [true, 'Token symbol is required'],
      trim: true,
      uppercase: true
    },
    logo: {
      type: String,
      required: [true, 'Token logo URL is required'],
      trim: true
    },
    balance: {
      type: Number,
      required: [true, 'Token balance is required'],
      min: [0, 'Balance cannot be negative'],
      default: 0
    },
    buyPrice: {
      type: Number,
      min: [0, 'Buy price cannot be negative'],
      default: null
    },
    currentPrice: {
      type: Number,
      required: [true, 'Current price is required'],
      min: [0, 'Current price cannot be negative'],
      default: 0
    },
    currentValue: {
      type: Number,
      required: [true, 'Current value is required'],
      min: [0, 'Current value cannot be negative'],
      default: 0
    },
    soldAt: {
      type: Number,
      min: [0, 'Sold price cannot be negative'],
      default: null
    },
    lastSoldAt: {
      type: Date,
      default: null
    },
    totalPurchased: {
      type: Number,
      min: [0, 'Total purchased cannot be negative'],
      default: 0
    },
    totalSold: {
      type: Number,
      min: [0, 'Total sold cannot be negative'],
      default: 0
    },
    status: {
      type: String,
      enum: ['available', 'sold'],
      default: 'available'
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

// Compound indexes for efficient querying
assetSchema.index({ userId: 1, mint: 1 }, { unique: true });
assetSchema.index({ userId: 1, status: 1 });
assetSchema.index({ mint: 1, status: 1 });
assetSchema.index({ updatedAt: -1 });
assetSchema.index({ lastSoldAt: -1 });
assetSchema.index({ userId: 1, lastSoldAt: -1 });

// Pre-save middleware to calculate current value
assetSchema.pre('save', function (next) {
  // Calculate current value based on balance and current price
  this.currentValue = this.balance * this.currentPrice;
  next();
});

// Instance method to update price and recalculate value
assetSchema.methods.updatePrice = function (newPrice: number) {
  this.currentPrice = newPrice;
  this.currentValue = this.balance * newPrice;
  this.updatedAt = new Date();
};

// Instance method to update balance and recalculate value
assetSchema.methods.updateBalance = function (newBalance: number) {
  this.balance = newBalance;
  this.currentValue = newBalance * this.currentPrice;
  this.updatedAt = new Date();
};

// Static method to find assets by user
assetSchema.statics.findByUser = function (userId: string) {
  return this.find({ userId, status: 'available' }).sort({ createdAt: -1 });
};

// Method to calculate profit/loss percentage
assetSchema.methods.calculateProfitLoss = function(): number {
  if (!this.buyPrice || this.buyPrice === 0) return 0;
  return ((this.currentPrice - this.buyPrice) / this.buyPrice) * 100;
};

// Method to calculate realized profit/loss from sales
assetSchema.methods.calculateRealizedProfitLoss = function(): number {
  if (!this.buyPrice || !this.soldAt || this.totalSold === 0) return 0;
  const soldValue = this.totalSold * this.soldAt;
  const costBasis = this.totalSold * this.buyPrice;
  return soldValue - costBasis;
};

// Method to check if asset is effectively empty (only when actually 0)
assetSchema.methods.isEffectivelyEmpty = function(): boolean {
  return this.balance === 0;
};

// Method to calculate total profit/loss (both realized and unrealized)
assetSchema.methods.calculateTotalProfitLoss = function(): { realized: number, unrealized: number, total: number } {
  const realized = this.calculateRealizedProfitLoss();
  const unrealized = this.balance * (this.currentPrice - (this.buyPrice || 0));
  return {
    realized,
    unrealized,
    total: realized + unrealized
  };
};

// Static method to find assets by mint
assetSchema.statics.findByMint = function (mint: string) {
  return this.find({ mint, status: 'available' });
};

export const Asset = mongoose.model<IAsset>('Asset', assetSchema); 