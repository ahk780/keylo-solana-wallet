// Load environment variables FIRST
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import './config'; // Load config early
import { connectDatabase } from './utils/database';
import authRoutes from './routes/authRoutes';
import userRoutes from './routes/userRoutes';
import priceRoutes from './routes/priceRoutes';
import orderRoutes from './routes/orderRoutes';
import tokenRoutes from './routes/tokenRoutes';
import adminRoutes from './routes/adminRoutes';
import otpRoutes from './routes/otpRoutes';
import { startAssetDiscoveryJob, stopAssetDiscoveryJob } from './jobs/assetDiscoveryJob';
import { startTrendingTokensJob } from './jobs/trendingTokensJob';
import { startSolPriceJob, stopSolPriceJob } from './jobs/solPriceJob';
import { startLimitOrdersJob, stopLimitOrdersJob } from './jobs/limitOrdersJob';
import { startTransactionMonitorJob, stopTransactionMonitorJob } from './jobs/transactionMonitorJob';
import { startTokenCleanupJob, stopTokenCleanupJob } from './jobs/tokenCleanupJob';
import { IApiResponse } from './types';

const app = express();
const PORT = process.env.PORT || 3000;

// ⚠️ CRITICAL: Configure trust proxy IMMEDIATELY after creating Express app
// This is required when behind reverse proxies, load balancers, or CDNs (like Cloudflare)
console.log('🔧 Debug Environment Variables:');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('TRUST_PROXY:', process.env.TRUST_PROXY);

// For Cloudflare, always trust first proxy in production
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
  console.log('🌥️ Cloudflare configuration applied: trust proxy = 1');
  console.log(`✅ Express trust proxy setting: ${app.get('trust proxy')}`);
} else {
  // Development mode
  const trustProxy = process.env.TRUST_PROXY;
  if (trustProxy && trustProxy !== 'false') {
    const proxyValue = trustProxy === 'true' ? true : parseInt(trustProxy) || 1;
    app.set('trust proxy', proxyValue);
    console.log(`✅ Trust proxy enabled: ${trustProxy} (value: ${proxyValue})`);
  } else {
    app.set('trust proxy', false);
    console.log('ℹ️ Trust proxy disabled for development');
  }
}

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

// CORS configuration
const corsOptions = {
  origin: function (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const allowedOrigins = [frontendUrl];
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS policy'), false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  maxAge: 86400, // 24 hours
};

app.use(cors(corsOptions));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Global rate limiting
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  message: {
    success: false,
    message: 'Too many requests from this IP',
    error: 'Please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(globalLimiter);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/user/orders', orderRoutes);
app.use('/api/price', priceRoutes);
app.use('/api/token', tokenRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/otp', otpRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Solana Wallet Backend is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Welcome to Solana Wallet Backend API',
    version: '1.0.0',
    documentation: '/api/health',
    timestamp: new Date().toISOString()
  });
});

// Handle 404 errors
app.use('*', (req, res) => {
  const response: IApiResponse = {
    success: false,
    message: 'Route not found',
    error: `The endpoint ${req.originalUrl} does not exist`
  };
  res.status(404).json(response);
});

// Global error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Global error handler:', err);
  
  // Handle CORS errors
  if (err.message === 'Not allowed by CORS policy') {
    const response: IApiResponse = {
      success: false,
      message: 'CORS policy violation',
      error: 'Origin not allowed'
    };
    return res.status(403).json(response);
  }
  
  // Handle JSON parsing errors
  if (err instanceof SyntaxError && 'body' in err) {
    const response: IApiResponse = {
      success: false,
      message: 'Invalid JSON',
      error: 'Request body contains invalid JSON'
    };
    return res.status(400).json(response);
  }
  
  // Handle rate limit errors
  if (err.message && err.message.includes('Too many requests')) {
    const response: IApiResponse = {
      success: false,
      message: 'Rate limit exceeded',
      error: 'Too many requests, please try again later'
    };
    return res.status(429).json(response);
  }
  
  // Default error response
  const response: IApiResponse = {
    success: false,
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  };
  
  return res.status(500).json(response);
});

// Start server function
const startServer = async () => {
  try {
    // Connect to database
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error('MONGODB_URI is not defined in environment variables');
    }
    
    await connectDatabase(mongoUri);
    
    // Start asset discovery job
    startAssetDiscoveryJob();
    
    // Start trending tokens job
    await startTrendingTokensJob();
    
    // Start SOL price monitoring job
    await startSolPriceJob();
    
    // Start limit orders monitoring job
    startLimitOrdersJob();
    
    // Start transaction monitoring job
    await startTransactionMonitorJob();
    
    // Start token cleanup job (removes old invalidated tokens)
    startTokenCleanupJob();
    
    // Start listening
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📂 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🌐 CORS enabled for: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
      console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  stopAssetDiscoveryJob();
  stopSolPriceJob();
  stopLimitOrdersJob();
  await stopTransactionMonitorJob();
  stopTokenCleanupJob();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully');
  stopAssetDiscoveryJob();
  stopSolPriceJob();
  stopLimitOrdersJob();
  await stopTransactionMonitorJob();
  stopTokenCleanupJob();
  process.exit(0);
});

// Start the server
startServer();

export default app; 