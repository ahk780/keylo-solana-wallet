import mongoose, { Schema } from 'mongoose';
import { IWallet } from '../types';

const walletSchema = new Schema<IWallet>(
  {
    privateKey: {
      type: String,
      required: [true, 'Private key is required'],
      unique: true
    },
    publicKey: {
      type: String,
      required: [true, 'Public key is required'],
      unique: true
    },
    userId: {
      type: String,
      required: [true, 'User ID is required'],
      ref: 'User'
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

// Indexes are automatically created by unique: true in schema
// Additional unique index for userId to ensure one wallet per user
walletSchema.index({ userId: 1 }, { unique: true });

// Transform output to hide sensitive information
walletSchema.methods.toJSON = function () {
  const walletObject = this.toObject();
  delete walletObject.privateKey;
  return walletObject;
};

export const Wallet = mongoose.model<IWallet>('Wallet', walletSchema); 