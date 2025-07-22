import { Document } from 'mongoose';

export interface IUser extends Document {
  _id: string;
  name: string;
  email: string;
  password: string;
  wallet: string; // Public wallet address
  role: 'user' | 'moderator' | 'admin';
  status: 'active' | 'banned';
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
}

export interface IOTP extends Document {
  _id: string;
  userId?: string; // Optional for register type
  email: string;
  otp: string;
  userIp: string;
  type: 'login' | 'register' | 'withdraw' | 'security';
  status: 'pending' | 'used' | 'expired';
  createdAt: Date;
  updatedAt: Date;
}

export interface IWallet extends Document {
  _id: string;
  privateKey: string; // Encrypted private key
  publicKey: string; // Public wallet address
  userId: string; // Reference to user
  createdAt: Date;
  updatedAt: Date;
}

export interface ITransaction extends Document {
  _id: string;
  userId: string; // Reference to user
  signature: string; // Transaction signature
  type: 'swap' | 'buy' | 'sell' | 'send' | 'receive' | 'stake' | 'unstake' | 'other';
  dex: 'pumpfun' | 'launchlab' | 'raydium' | 'meteora' | 'jupiter' | 'unknown';
  status: 'confirmed' | 'failed' | 'pending';
  blockTime: Date;
  slot: number;
  fee: number;
  from: string; // Sender wallet address
  to: string; // Receiver wallet address
  tokenIn: {
    mint?: string;
    name?: string;
    symbol?: string;
    logo?: string;
    amount?: number;
    decimals?: number;
  };
  tokenOut: {
    mint?: string;
    name?: string;
    symbol?: string;
    logo?: string;
    amount?: number;
    decimals?: number;
  };
  priceInSol: number;
  priceInUsd: number;
  programIds: string[];
  rawTransaction?: any;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAsset extends Document {
  _id: string;
  userId: string; // Reference to user who owns this asset
  mint: string; // Token mint address
  tokenAccount: string; // Token account address for this mint
  name: string; // Name of the token
  symbol: string; // Symbol of the token
  logo: string; // Token URI logo image URL
  balance: number; // Token balance
  buyPrice?: number; // Price when bought (optional)
  currentPrice: number; // Current price in USD
  currentValue: number; // Current value (currentPrice * balance)
  soldAt?: number; // Price when sold (optional)
  lastSoldAt?: Date; // Timestamp of last sale (optional)
  totalPurchased?: number; // Total amount ever purchased (optional)
  totalSold?: number; // Total amount ever sold (optional)
  status: 'available' | 'sold';
  createdAt: Date;
  updatedAt: Date;
  updatePrice(newPrice: number): void;
  updateBalance(newBalance: number): void;
  calculateProfitLoss(): number;
  calculateRealizedProfitLoss(): number;
  isEffectivelyEmpty(): boolean;
  calculateTotalProfitLoss(): { realized: number, unrealized: number, total: number };
}

export interface IAuthPayload {
  userId: string;
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}

export interface IRegisterRequest {
  name: string;
  email: string;
  password: string;
}

export interface ILoginRequest {
  email: string;
  password: string;
}

export interface ITransferRequest {
  mint: string;
  amount: number;
  to: string;
}

export interface IAuthResponse {
  success: boolean;
  message: string;
  data?: {
    user: Omit<IUser, 'password'>;
    token: string;
  };
}

export interface IValidationError {
  field: string;
  message: string;
}

export interface IApiResponse<T = any> {
  success: boolean;
  message: string;
  data?: T;
  error?: string | IValidationError[];
}

export interface ITokenMetadata {
  name: string;
  symbol: string;
  logo: string;
  mint: string;
}

export interface ICoinveraPriceResponse {
  ca: string;
  dex?: string;
  poolId?: string;
  liquidity?: string;
  priceInSol?: string;
  priceInUsd?: string;
  error?: string;
}

export interface ITokenAccountInfo {
  mint: string;
  tokenAccount: string;
  balance: number;
  owner: string;
}

export interface ITradingRequest {
  mint: string;
  amount: number;
  dex: 'raydium' | 'meteora' | 'pumpfun' | 'launchlab' | 'moonshot' | 'jupiter';
  tip: number;
  slippage: number;
  type: 'buy' | 'sell';
}

export interface ISolanaPortalRequest {
  wallet_address: string;
  action: 'buy' | 'sell';
  dex: string;
  mint: string;
  amount: number;
  slippage: number;
  tip: number;
  type: 'jito';
}

export interface ITradingResponse {
  success: boolean;
  message: string;
  data?: {
    signature: string;
    txUrl: string;
    price: number;
    amount: number;
    type: 'buy' | 'sell';
  };
  error?: string;
}

export interface ITrendingRequest {
  hour: number;
  limit: number;
}

export interface ICoinveraTrendingToken {
  buy_volume_usd: number;
  latest_price: number;
  net_inflow_usd: number;
  sell_volume_usd: number;
  token_address: string;
  token_symbol: string;
}

export interface ICoinveraTrendingResponse {
  [key: string]: ICoinveraTrendingToken | number;
  hour: number;
  limit: number;
}

export interface ITrendingTokenData {
  mint: string;
  name: string;
  symbol: string;
  logo: string;
  buy_volume_usd: number;
  latest_price: number;
  net_inflow_usd: number;
  sell_volume_usd: number;
}

export interface ISolPriceData {
  solPriceUsd: number;
  usdtPriceInSol: number;
  usdtPriceInUsd: number;
  lastUpdated: Date;
  source: string;
  isValid: boolean;
}

export interface ISolPriceResponse {
  success: boolean;
  message: string;
  data?: ISolPriceData;
  error?: string;
}

export interface ITokenInfo {
  name: string;
  symbol: string;
  logo: string;
  priceInUsd: number;
  mint: string;
}

export interface ITokenInfoResponse {
  success: boolean;
  message: string;
  data?: ITokenInfo;
  error?: string;
}

export interface IOrder extends Document {
  _id: string;
  userId: string;
  mint: string;
  name: string;
  symbol: string;
  logo: string;
  amount: number;
  dex: 'raydium' | 'meteora' | 'pumpfun' | 'launchlab' | 'moonshot' | 'jupiter';
  orderType: 'high' | 'low';
  triggerPrice: number;
  currentPrice: number;
  slippage: number;
  tip: number;
  signature: string | null;
  type: 'buy' | 'sell';
  status: 'waiting' | 'triggered' | 'failed';
  createdAt: Date;
  updatedAt: Date;
}

export interface ICreateOrderRequest {
  mint: string;
  amount: number;
  dex: 'raydium' | 'meteora' | 'pumpfun' | 'launchlab' | 'moonshot' | 'jupiter';
  order_type: 'high' | 'low';
  trigger_price: number;
  slippage: number;
  tip: number;
  type: 'buy' | 'sell';
}

export interface IUpdateOrderRequest {
  amount?: number;
  dex?: 'raydium' | 'meteora' | 'pumpfun' | 'launchlab' | 'moonshot' | 'jupiter';
  order_type?: 'high' | 'low';
  trigger_price?: number;
  slippage?: number;
  tip?: number;
  type?: 'buy' | 'sell';
}

export interface IOrderResponse {
  success: boolean;
  message: string;
  data?: IOrder | IOrder[];
  error?: string;
}

export interface ITokenOverviewRequest {
  mint: string;
}

export interface ITokenOverviewResponse {
  success: boolean;
  message: string;
  data?: ITokenOverview | { error: string };
  error?: string;
}

export interface ITokenOverview {
  ca: string;
  name: string;
  symbol: string;
  image: string;
  description: string | null;
  socials: {
    telegram?: string;
    twitter?: string;
    website?: string;
  };
  decimals: string;
  supply: string;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  updateAuthority: string;
  creators: Array<{
    address: string;
    verified: boolean;
    share: string;
  }>;
  isToken2022: boolean;
  top10HoldersBalance: string;
  top10HoldersPercent: string;
  top20HoldersBalance: string;
  top20HoldersPercent: string;
  dex: string;
  poolId?: string; // Optional field for some DEXs
  liquidity?: string; // Optional field for some DEXs
  priceInSol: string;
  priceInUsd: string;
  bondingCurveProgress?: string; // Optional field for some tokens
  marketCap: string;
} 