import mongoose, { Schema, Document } from 'mongoose';
import { SOL_MINT } from '../utils/transfer';

// Enhanced transaction interface - send, receive, swap, burn, close
interface IFilteredTransaction extends Document {
  userId: string; // For user association
  signature: string;
  slot: number;
  type: 'send' | 'receive' | 'swap' | 'burn' | 'close';
  dex: string; // From DEX list or "Unknown"
  mint: string; // Token mint address or SOL address
  amount: number; // +/- based on direction
  value: number; // USD value calculated from price
  name: string;
  symbol: string;
  logo: string;
  from: string;
  to: string;
  status: 'confirmed'; // Only confirmed transactions
  created_at: Date;
}

const transactionSchema = new Schema<IFilteredTransaction>(
  {
    userId: {
      type: String,
      required: [true, 'User ID is required'],
      ref: 'User',
      index: true
    },
    signature: {
      type: String,
      required: [true, 'Transaction signature is required'],
      unique: true,
      trim: true,
      index: true
    },
    slot: {
      type: Number,
      required: [true, 'Slot number is required'],
      index: true
    },
    type: {
      type: String,
      enum: ['send', 'receive', 'swap', 'burn', 'close'],
      required: [true, 'Transaction type is required'],
      index: true
    },
    dex: {
      type: String,
      required: [true, 'DEX name is required'],
      default: 'Unknown',
      index: true
    },
    mint: {
      type: String,
      required: [true, 'Token mint address is required'],
      trim: true,
      index: true
    },
    amount: {
      type: Number,
      required: [true, 'Amount is required']
    },
    value: {
      type: Number,
      required: [true, 'USD value is required'],
      default: 0
    },
    name: {
      type: String,
      required: [true, 'Token name is required'],
      trim: true
    },
    symbol: {
      type: String,
      required: [true, 'Token symbol is required'],
      trim: true
    },
    logo: {
      type: String,
      required: [true, 'Token logo is required'],
      trim: true
    },
    from: {
      type: String,
      required: [true, 'From address is required'],
      trim: true
    },
    to: {
      type: String,
      required: [true, 'To address is required'],
      trim: true
    },
    status: {
      type: String,
      enum: ['confirmed'],
      default: 'confirmed',
      required: true
    },
    created_at: {
      type: Date,
      required: [true, 'Creation time is required'],
      default: Date.now,
      index: true
    }
  },
  {
    versionKey: false,
    timestamps: false // Using custom created_at
  }
);

// Optimized indexes for ultra-fast queries
transactionSchema.index({ userId: 1, created_at: -1 }); // Primary user query
transactionSchema.index({ type: 1, created_at: -1 }); // Filter by type
transactionSchema.index({ mint: 1, created_at: -1 }); // Filter by token
transactionSchema.index({ from: 1 }); // From address queries
transactionSchema.index({ to: 1 }); // To address queries
transactionSchema.index({ slot: -1 }); // Blockchain ordering

export const Transaction = mongoose.model<IFilteredTransaction>('Transaction', transactionSchema);
export { SOL_MINT }; 