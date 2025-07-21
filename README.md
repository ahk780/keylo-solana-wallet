# 🚀 Multi-Purpose Solana Wallet Backend

**Your comprehensive Solana wallet solution** - Trade on multiple DEXs, manage assets, monitor trends, and handle secure transactions all in one powerful backend system.

## 💬 Need Help?

Having trouble with installation or need support? Join our community!

📱 **Telegram Community**: https://t.me/ahk782  
🛠️ **Telegram Support**: https://t.me/ahk780

## 🌟 Highlighted Features

✨ **Multi-DEX Trading Hub** - Trade seamlessly across **PumpFun**, **Raydium**, **Meteora**, **LaunchLab**, **Moonshot**, and **Jupiter** - all from one unified platform

🔒 **Bank-Level Security** - Advanced JWT authentication, encrypted private keys, comprehensive session management, and role-based access control

💰 **Complete Asset Management** - Real-time portfolio tracking, automated asset discovery, intelligent token operations (burn/close accounts), and comprehensive transaction history

📈 **Live Market Intelligence** - Real-time trending tokens, SOL price monitoring, comprehensive token metadata, and market analytics from trusted sources

⚡ **Advanced Trading Features** - Automated limit orders, smart transaction monitoring, multi-DEX swap detection, and performance analytics

🎯 **Developer-Friendly** - RESTful APIs, TypeScript support, comprehensive documentation, and extensible architecture for custom endpoints

💸 **Secure Transfers** - Send and receive SOL/SPL tokens with automatic token account creation, transaction verification, and detailed history tracking

📊 **Professional Dashboard** - Real-time portfolio insights, profit/loss tracking, trading analytics, and comprehensive user statistics

## 🎨 Frontend Options

**Ready-to-Use Frontend**: Get started instantly with our professional frontend interface:
👉 **https://github.com/ahk780/keylo-solana-wallet-frontend**

**Custom Development**: The backend's RESTful API architecture makes it easy to create your own custom frontend or integrate with existing applications. All endpoints are fully documented and follow standard REST conventions.

## 🔧 Custom Endpoints

Want to add your own functionality? The system is built with extensibility in mind:

- **Easy Integration**: Add new routes following the existing patterns
- **Middleware Ready**: Authentication, validation, and rate limiting middleware available
- **Database Models**: Extend existing models or create new ones
- **Background Jobs**: Add custom scheduled tasks using the job system
- **API Standards**: All endpoints follow RESTful conventions with consistent response formats

## Features

- **User Authentication**: JWT-based authentication with register, login, session validation, and secure logout
- **Advanced Session Management**: Token blacklisting with automatic cleanup and permanent invalidation
- **Secure Logout System**: Complete token invalidation preventing reuse and automatic cleanup of expired sessions
- **Solana Wallet Generation**: Automatic wallet creation with base58 encoded private keys
- **Private Key Encryption**: Secure AES encryption for private key storage
- **Token Transfers**: Support for SOL and SPL token transfers with automatic token account creation
- **Token Operations**: Complete token management including burn and close account functionality  
- **Token Account Management**: Burn unwanted tokens and close empty accounts to recover rent
- **Token Overview API**: Comprehensive token information from Coinvera API with market data and analytics
- **Real-Time Transaction Monitoring**: Advanced RPC-based transaction monitoring with automatic classification
- **Enhanced Transaction Detection**: Signer-based detection for send/receive/swap/burn/close with duplication prevention
- **Comprehensive Transaction History**: Complete transaction tracking with chronological storage and human-readable formatting
- **DEX Integration**: Multi-DEX swap detection (Pump.fun, Raydium, Jupiter, Orca, Serum, Meteora, Phoenix, Lifinity)
- **Asset Discovery**: Continuous background job that monitors user wallets for all token assets (no dust filtering)
- **Price Tracking**: Real-time price updates using Coinvera API with intelligent rate limiting
- **Portfolio Management**: Complete asset portfolio with balance tracking and valuation
- **Token Metadata**: Multi-source metadata fetching with intelligent fallbacks (Local List → Registry → Blockchain → Helius)
- **Local Token Database**: tokens.json file for instant metadata retrieval of common tokens
- **Trending Tokens**: Background-cached trending token data with 30-minute refresh cycles
- **SOL Price Monitoring**: Real-time SOL price tracking via USDT bridge with 1-minute refresh cycles
- **Token Info API**: Fast token metadata and price fetching with parallel processing
- **Token Overview**: Comprehensive token information including metadata, holder distribution, market data, and DEX information
- **Limit Orders**: Automated buy/sell orders with price monitoring, custom slippage and tip support
- **Enhanced Dashboard Analytics**: Comprehensive portfolio, trading, and performance statistics with transaction insights
- **MongoDB Integration**: Professional database schema with proper indexing
- **Input Validation**: Comprehensive validation and sanitization
- **Rate Limiting**: Protection against abuse and DDoS attacks
- **CORS Support**: Configurable CORS for frontend integration
- **Error Handling**: Centralized error handling with proper HTTP status codes
- **TypeScript**: Full TypeScript support with proper type definitions

## Tech Stack

- **Node.js** + **Express.js** - Web framework
- **TypeScript** - Type safety
- **MongoDB** + **Mongoose** - Database and ODM
- **JWT** - Authentication tokens
- **bcryptjs** - Password hashing
- **@solana/web3.js** - Solana blockchain integration
- **@solana/spl-token** - SPL token operations
- **@solana/spl-token-registry** - Token metadata
- **crypto-js** - Private key encryption
- **express-validator** - Input validation
- **helmet** - Security middleware
- **cors** - Cross-origin resource sharing
- **express-rate-limit** - Rate limiting
- **node-cron** - Background job scheduling
- **axios** - HTTP client for API requests
- **Coinvera API** - Real-time token price data and comprehensive token overview
- **Helius API** - Enhanced token metadata fetching

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Setup

Copy the environment template and configure your settings:

```bash
cp env.template .env
```

Update the `.env` file with your configuration:

```env
# Database Configuration
MONGODB_URI=mongodb://localhost:27017/solana-wallet
MONGODB_DB_NAME=solana-wallet

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-here-make-it-long-and-random
JWT_EXPIRES_IN=7d

# Encryption Configuration
ENCRYPTION_KEY=your-32-character-encryption-key-here

# Server Configuration
PORT=3000
NODE_ENV=development

# CORS Configuration
FRONTEND_URL=http://localhost:3000

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# Solana Configuration
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_CLUSTER=mainnet-beta

# Coinvera API Configuration
COINVERA_APIKEY=your-coinvera-api-key-here
COINVERA_LIMIT=50

# Helius API Configuration
HELIUS_APIKEY=your-helius-api-key-here

# Asset Job Configuration
ASSET_JOB_INTERVAL=10000
ASSET_JOB_ENABLED=true
```

### 3. Development

```bash
# Run in development mode with hot reload
npm run dev

# Build for production
npm run build

# Run production build
npm start
```

**Note**: The transaction monitoring, SOL price monitoring, limit orders, and token cleanup systems will automatically start when the server starts. The transaction monitor continuously tracks all user wallet activity in real-time (including burns and account closures), the SOL price system fetches price data every minute, limit orders job monitors and executes orders continuously, and the token cleanup system removes old invalidated sessions every 24 hours. All systems use the same `COINVERA_APIKEY` configured for price and metadata operations.

## 📚 API Documentation

The backend provides comprehensive RESTful endpoints for:

- **Authentication**: User registration, login, session management, and secure logout
- **Wallet Operations**: Balance checking, token transfers, and transaction history
- **Asset Management**: Portfolio tracking, asset discovery, and token operations
- **Trading**: Multi-DEX trading, limit orders, and market data
- **Analytics**: Dashboard statistics, performance tracking, and insights

All endpoints return consistent JSON responses with proper HTTP status codes and error handling. Authentication is handled via JWT tokens with secure session management.

## Database Schema

### Users Collection
```javascript
{
  _id: ObjectId,
  name: String,
  email: String (unique),
  password: String (hashed),
  wallet: String (public key),
  role: String (user|moderator|admin),
  status: String (active|banned),
  createdAt: Date,
  updatedAt: Date
}
```

### Transactions Collection
```javascript
{
  _id: ObjectId,
  userId: String (user reference),
  signature: String (unique transaction signature),
  slot: Number (blockchain slot number),
  type: String ('send' | 'receive' | 'swap' | 'burn' | 'close'),
  dex: String (DEX name or 'Unknown'),
  mint: String (token mint address),
  amount: Number (positive for receive, negative for send/swap),
  value: Number (USD value),
  name: String (token name),
  symbol: String (token symbol),
  logo: String (token logo URL),
  from: String (sender address),
  to: String (receiver address),
  status: String ('confirmed'),
  created_at: Date (transaction timestamp),
}
```

### Wallets Collection
```javascript
{
  _id: ObjectId,
  privateKey: String (encrypted),
  publicKey: String (unique),
  userId: ObjectId (ref: User),
  createdAt: Date,
  updatedAt: Date
}
```

### Assets Collection
```javascript
{
  _id: ObjectId,
  userId: ObjectId (ref: User),
  mint: String (token mint address),
  tokenAccount: String (token account address),
  name: String (token name),
  symbol: String (token symbol),
  logo: String (token logo URL),
  balance: Number (token balance),
  buyPrice: Number (buy price when purchased - optional),
  currentPrice: Number (current price in USD),
  currentValue: Number (current value = balance * currentPrice),
  soldAt: Number (sell price when sold - optional),
  lastSoldAt: Date (timestamp of last sale - optional),
  totalPurchased: Number (total amount ever purchased - default 0),
  totalSold: Number (total amount ever sold - default 0),
  status: String (available|sold - only sold when balance is effectively zero),
  createdAt: Date,
  updatedAt: Date
}
```

### Orders Collection
```javascript
{
  _id: ObjectId,
  userId: ObjectId (ref: User),
  mint: String (token mint address),
  name: String (token name),
  symbol: String (token symbol),
  logo: String (token logo URL),
  amount: Number (amount to buy/sell),
  dex: String (raydium|meteora|pumpfun|launchlab|moonshot|jupiter),
  orderType: String (high|low - default: low),
  triggerPrice: Number (price at which to execute order),
  currentPrice: Number (current market price),
  slippage: Number (slippage tolerance percentage 0-100),
  tip: Number (tip amount for transaction priority),
  signature: String (transaction signature - null until executed),
  type: String (buy|sell - default: buy),
  status: String (waiting|triggered|failed - default: waiting),
  createdAt: Date,
  updatedAt: Date
}
```

## Security Features

### Authentication
- JWT tokens with configurable expiration
- Password hashing with bcrypt (12 rounds)
- Session validation middleware
- Role-based access control
- **Complete logout system with token blacklisting**
- **Automatic session cleanup and invalidation**
- **Token reuse prevention and security validation**

### Encryption
- AES encryption for private keys
- Environment-based encryption keys
- Secure key derivation

### Rate Limiting
- Global rate limiting (1000 requests/15 minutes)
- Auth endpoint limiting (5 attempts/15 minutes)
- Customizable rate limits

### Input Validation
- Comprehensive validation rules
- XSS protection
- SQL injection prevention
- Input sanitization

### Security Headers
- Helmet.js for security headers
- CORS configuration
- Content Security Policy

## Error Handling

All API responses follow a consistent format:

### Success Response
```json
{
  "success": true,
  "message": "Operation successful",
  "data": {...}
}
```

### Error Response
```json
{
  "success": false,
  "message": "Operation failed",
  "error": "Detailed error message"
}
```

### HTTP Status Codes
- `200` - Success
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `429` - Too Many Requests
- `500` - Internal Server Error

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

For support, email support@keylo.io or join our Slack channel. 