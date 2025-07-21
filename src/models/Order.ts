import { Schema, model } from 'mongoose';
import { IOrder } from '../types';

const OrderSchema = new Schema<IOrder>({
  userId: {
    type: String,
    required: true,
    index: true
  },
  mint: {
    type: String,
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true
  },
  symbol: {
    type: String,
    required: true
  },
  logo: {
    type: String,
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  dex: {
    type: String,
    required: true,
    enum: ['raydium', 'meteora', 'pumpfun', 'launchlab', 'moonshot', 'jupiter']
  },
  orderType: {
    type: String,
    required: true,
    enum: ['high', 'low'],
    default: 'low'
  },
  triggerPrice: {
    type: Number,
    required: true,
    min: 0
  },
  currentPrice: {
    type: Number,
    required: true,
    min: 0
  },
  slippage: {
    type: Number,
    required: true,
    min: 0,
    max: 100
  },
  tip: {
    type: Number,
    required: true,
    min: 0
  },
  signature: {
    type: String,
    default: null
  },
  type: {
    type: String,
    required: true,
    enum: ['buy', 'sell'],
    default: 'buy'
  },
  status: {
    type: String,
    required: true,
    enum: ['waiting', 'triggered', 'failed'],
    default: 'waiting',
    index: true
  }
}, {
  timestamps: true
});

// Compound indexes for efficient queries
OrderSchema.index({ userId: 1, status: 1 });
OrderSchema.index({ mint: 1, status: 1 });
OrderSchema.index({ status: 1, triggerPrice: 1 });

export const Order = model<IOrder>('Order', OrderSchema); 