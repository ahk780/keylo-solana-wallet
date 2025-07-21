import mongoose, { Schema, Document } from 'mongoose';

interface IInvalidatedToken extends Document {
  token: string;
  userId: string;
  reason: 'logout' | 'expired' | 'security';
  invalidatedAt: Date;
  expiresAt: Date; // Original token expiration
}

const invalidatedTokenSchema = new Schema<IInvalidatedToken>(
  {
    token: {
      type: String,
      required: [true, 'Token is required'],
      unique: true,
      index: true
    },
    userId: {
      type: String,
      required: [true, 'User ID is required'],
      ref: 'User',
      index: true
    },
    reason: {
      type: String,
      enum: ['logout', 'expired', 'security'],
      required: [true, 'Invalidation reason is required'],
      default: 'logout'
    },
    invalidatedAt: {
      type: Date,
      required: [true, 'Invalidation time is required'],
      default: Date.now
    },
    expiresAt: {
      type: Date,
      required: [true, 'Token expiration time is required'],
      index: true
    }
  },
  {
    timestamps: false,
    versionKey: false
  }
);

// TTL index to automatically delete old invalidated tokens after 8 days
invalidatedTokenSchema.index({ invalidatedAt: 1 }, { expireAfterSeconds: 8 * 24 * 60 * 60 }); // 8 days in seconds

// Compound indexes for efficient queries
invalidatedTokenSchema.index({ token: 1, invalidatedAt: 1 });
invalidatedTokenSchema.index({ userId: 1, invalidatedAt: -1 });

// Static method to check if a token is invalidated
invalidatedTokenSchema.statics.isTokenInvalidated = async function(token: string): Promise<boolean> {
  const invalidatedToken = await this.findOne({ token });
  return !!invalidatedToken;
};

// Static method to invalidate a token
invalidatedTokenSchema.statics.invalidateToken = async function(
  token: string, 
  userId: string, 
  expiresAt: Date, 
  reason: 'logout' | 'expired' | 'security' = 'logout'
): Promise<void> {
  await this.create({
    token,
    userId,
    reason,
    expiresAt,
    invalidatedAt: new Date()
  });
};

// Static method to clean up old tokens (manual cleanup, though TTL handles this automatically)
invalidatedTokenSchema.statics.cleanupOldTokens = async function(): Promise<number> {
  const eightDaysAgo = new Date();
  eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);
  
  const result = await this.deleteMany({ invalidatedAt: { $lt: eightDaysAgo } });
  return result.deletedCount || 0;
};

export const InvalidatedToken = mongoose.model<IInvalidatedToken>('InvalidatedToken', invalidatedTokenSchema); 