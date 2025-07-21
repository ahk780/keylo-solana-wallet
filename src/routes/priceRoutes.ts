import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { getCachedSolPrice, getSolPriceJobStatus } from '../jobs/solPriceJob';
import { getTokenMetadata } from '../utils/tokenMetadata';
import { fetchTokenPrice, extractUsdPrice } from '../utils/priceUtils';
import { SOL_MINT } from '../utils/transfer';
import { ISolPriceResponse, IApiResponse, ITokenInfoResponse, ITokenInfo } from '../types';

const router = Router();

// Rate limiting for price endpoints
const priceLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // limit each IP to 60 requests per minute
  message: {
    success: false,
    message: 'Too many price requests',
    error: 'Please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiting to all price routes
router.use(priceLimiter);

/**
 * GET /api/price/sol
 * Get current SOL price from cache
 */
router.get('/sol', (req: Request, res: Response) => {
  try {
    const cachedData = getCachedSolPrice();
    
    if (!cachedData) {
      const response: ISolPriceResponse = {
        success: false,
        message: 'SOL price data not available',
        error: 'Price data is still being fetched. Please try again in a few moments.'
      };
      return res.status(503).json(response);
    }

    // Check if data is stale (older than 5 minutes)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    if (cachedData.lastUpdated < fiveMinutesAgo) {
      const response: ISolPriceResponse = {
        success: true,
        message: 'SOL price data (stale)',
        data: {
          ...cachedData,
          isValid: false
        }
      };
      return res.status(200).json(response);
    }

    // Return fresh data
    const response: ISolPriceResponse = {
      success: true,
      message: 'SOL price data retrieved successfully',
      data: cachedData
    };
    
    return res.status(200).json(response);
  } catch (error) {
    console.error('Error retrieving SOL price:', error);
    
    const response: ISolPriceResponse = {
      success: false,
      message: 'Failed to retrieve SOL price',
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
    
    return res.status(500).json(response);
  }
});

/**
 * GET /api/price/sol/status
 * Get SOL price job status information
 */
router.get('/sol/status', (req: Request, res: Response) => {
  try {
    const jobStatus = getSolPriceJobStatus();
    
    const response: IApiResponse = {
      success: true,
      message: 'SOL price job status retrieved successfully',
      data: jobStatus
    };
    
    return res.status(200).json(response);
  } catch (error) {
    console.error('Error retrieving SOL price job status:', error);
    
    const response: IApiResponse = {
      success: false,
      message: 'Failed to retrieve SOL price job status',
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
    
    return res.status(500).json(response);
  }
});



/**
 * GET /api/price/token
 * Get token metadata and price information
 * Query parameters: mint - Token mint address
 */
router.get('/token', async (req: Request, res: Response) => {
  try {
    const { mint } = req.query;
    
    // Validate mint parameter
    if (!mint || typeof mint !== 'string') {
      const response: ITokenInfoResponse = {
        success: false,
        message: 'Invalid request',
        error: 'mint parameter is required and must be a valid string'
      };
      return res.status(400).json(response);
    }

    // Validate mint format (basic Solana address validation)
    if (mint.length < 32 || mint.length > 44) {
      const response: ITokenInfoResponse = {
        success: false,
        message: 'Invalid mint address',
        error: 'mint must be a valid Solana address (32-44 characters)'
      };
      return res.status(400).json(response);
    }

    // Get API key from environment
    const apiKey = process.env.COINVERA_APIKEY;
    if (!apiKey) {
      const response: ITokenInfoResponse = {
        success: false,
        message: 'Service configuration error',
        error: 'Price service is not properly configured'
      };
      return res.status(503).json(response);
    }

    // Special handling for SOL mint address
    if (mint === SOL_MINT) {
      // Get SOL price from cache
      const cachedSolPrice = getCachedSolPrice();
      
      if (!cachedSolPrice) {
        const response: ITokenInfoResponse = {
          success: false,
          message: 'SOL price data not available',
          error: 'SOL price data is still being fetched. Please try again in a few moments.'
        };
        return res.status(503).json(response);
      }

      // Use hardcoded SOL metadata and cached price
      const tokenInfo: ITokenInfo = {
        name: 'Solana',
        symbol: 'SOL',
        logo: 'https://i.ibb.co/PsgjwHss/solana-sol-logo.png',
        priceInUsd: cachedSolPrice.solPriceUsd,
        mint: mint
      };

      const response: ITokenInfoResponse = {
        success: true,
        message: 'Token information retrieved successfully',
        data: tokenInfo
      };

      return res.status(200).json(response);
    }

    // Get RPC URL from environment for other tokens
    const rpcUrl = process.env.SOLANA_RPC_URL;
    if (!rpcUrl) {
      const response: ITokenInfoResponse = {
        success: false,
        message: 'Service configuration error',
        error: 'Solana RPC is not properly configured'
      };
      return res.status(503).json(response);
    }

    // Fetch metadata and price simultaneously for speed (non-SOL tokens)
    const [metadata, priceResponse] = await Promise.all([
      getTokenMetadata(mint, rpcUrl),
      fetchTokenPrice(mint, apiKey)
    ]);

    // Extract USD price from price response
    const priceInUsd = extractUsdPrice(priceResponse);

    // Combine the data
    const tokenInfo: ITokenInfo = {
      name: metadata.name,
      symbol: metadata.symbol,
      logo: metadata.logo,
      priceInUsd: priceInUsd,
      mint: mint
    };

    const response: ITokenInfoResponse = {
      success: true,
      message: 'Token information retrieved successfully',
      data: tokenInfo
    };

    return res.status(200).json(response);

  } catch (error) {
    console.error('Error retrieving token information:', error);
    
    const response: ITokenInfoResponse = {
      success: false,
      message: 'Failed to retrieve token information',
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
    
    return res.status(500).json(response);
  }
});

/**
 * GET /api/price/health
 * Health check for price service
 */
router.get('/health', (req: Request, res: Response) => {
  try {
    const cachedData = getCachedSolPrice();
    const jobStatus = getSolPriceJobStatus();
    
    const isHealthy = cachedData && cachedData.isValid && 
                     new Date(cachedData.lastUpdated).getTime() > Date.now() - 5 * 60 * 1000;
    
    const response: IApiResponse = {
      success: true,
      message: 'Price service health check',
      data: {
        status: isHealthy ? 'healthy' : 'unhealthy',
        solPriceAvailable: !!cachedData,
        lastUpdated: cachedData?.lastUpdated,
        jobStatus: jobStatus
      }
    };
    
    return res.status(isHealthy ? 200 : 503).json(response);
  } catch (error) {
    console.error('Error checking price service health:', error);
    
    const response: IApiResponse = {
      success: false,
      message: 'Price service health check failed',
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
    
    return res.status(500).json(response);
  }
});

export default router; 