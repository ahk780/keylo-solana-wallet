import { Connection, PublicKey } from '@solana/web3.js';
import { TokenListProvider } from '@solana/spl-token-registry';
import { ITokenMetadata } from '../types';
import fetch from 'node-fetch';
import * as defaultTokens from '../tokens.json';

// Cache for token metadata to avoid repeated API calls
const metadataCache = new Map<string, ITokenMetadata>();
const cacheTimestamps = new Map<string, number>();

// Cache TTL in milliseconds (1 hour for successful fetches, 10 minutes for fallbacks)
const CACHE_TTL_SUCCESS = 60 * 60 * 1000; // 1 hour
const CACHE_TTL_FALLBACK = 10 * 60 * 1000; // 10 minutes

// Default fallback metadata
const DEFAULT_METADATA: Omit<ITokenMetadata, 'mint'> = {
  name: 'Unknown',
  symbol: 'UNKNOWN',
  logo: 'https://www.coinvera.io/logo.png'
};

/**
 * Get token metadata from the local tokens.json file
 * @param {string} mint - Token mint address
 * @returns {ITokenMetadata | null} Token metadata or null if not found
 */
export const getTokenMetadataFromList = (mint: string): ITokenMetadata | null => {
  try {
    const tokenData = (defaultTokens as any)[mint];
    if (tokenData) {
      return {
        mint: mint,
        name: tokenData.name,
        symbol: tokenData.symbol,
        logo: tokenData.logo
      };
    }
    return null;
  } catch (error) {
    console.error(`Error fetching token metadata from local list for ${mint}:`, error);
    return null;
  }
};

/**
 * Validate and sanitize image URL to avoid placeholder URLs
 * @param {string | null | undefined} imageUrl - Image URL to validate
 * @returns {string} Validated image URL or default logo
 */
const validateImageUrl = (imageUrl: string | null | undefined): string => {
  if (!imageUrl) {
    return DEFAULT_METADATA.logo;
  }
  
  const imgStr = String(imageUrl).trim();
  
  // Check for invalid URLs
  if (!imgStr || 
      imgStr.includes('via.placeholder.com') || 
      imgStr.includes('placeholder') ||
      !imgStr.startsWith('http')) {
    return DEFAULT_METADATA.logo;
  }
  
     return imgStr;
};

/**
 * Fetch token metadata from Solana's official token list
 * @param {string} mint - Token mint address
 * @returns {Promise<ITokenMetadata | null>} Token metadata or null if not found
 */
export const getTokenMetadataFromRegistry = async (mint: string): Promise<ITokenMetadata | null> => {
  try {
    // Get the token list
    const provider = new TokenListProvider();
    const tokenList = await provider.resolve();
    
    // Find token by mint address
    const tokens = tokenList.getList();
    const token = tokens.find(token => token.address === mint);
    
    if (token) {
      return {
        name: token.name,
        symbol: token.symbol,
        logo: validateImageUrl(token.logoURI),
        mint: mint
      };
    }
    
    return null;
  } catch (error) {
    console.error(`Error fetching token metadata from registry for ${mint}:`, error);
    return null;
  }
};

/**
 * Fetch token metadata directly from the blockchain
 * @param {string} mint - Token mint address
 * @param {string} rpcUrl - Solana RPC URL
 * @returns {Promise<ITokenMetadata | null>} Token metadata or null if not found
 */
export const getTokenMetadataFromBlockchain = async (
  mint: string,
  rpcUrl: string
): Promise<ITokenMetadata | null> => {
  try {
    const connection = new Connection(rpcUrl, 'confirmed');
    const mintPubkey = new PublicKey(mint);
    
    // Get mint account info
    const mintInfo = await connection.getParsedAccountInfo(mintPubkey);
    
    if (!mintInfo.value) {
      return null;
    }
    
    // Try multiple metadata programs/approaches
    const metadataPrograms = [
      'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s', // Standard Metaplex
      '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', // Pump.fun metadata program
    ];
    
    for (const programId of metadataPrograms) {
      try {
        const metadataAddress = await getMetadataAddress(mintPubkey, programId);
        const metadataAccount = await connection.getAccountInfo(metadataAddress);
        
        if (metadataAccount && metadataAccount.data) {
          const metadata = await parseMetadata(metadataAccount.data);
          if (metadata && metadata.name && metadata.symbol) {
            return {
              name: metadata.name,
              symbol: metadata.symbol,
              logo: metadata.image || DEFAULT_METADATA.logo,
              mint: mint
            };
          } else {
            // Try alternative parsing approach for pump.fun tokens
            const altMetadata = await parseMetadataAlternative(metadataAccount.data);
            if (altMetadata && altMetadata.name && altMetadata.symbol) {
              return {
                name: altMetadata.name,
                symbol: altMetadata.symbol,
                logo: altMetadata.image || DEFAULT_METADATA.logo,
                mint: mint
              };
            }
          }
        }
              } catch (error) {
          // Silent error - continue to next program
        }
          }
      
      // Try alternative metadata derivation for pump.fun tokens
      if (mint.includes('pump')) {
        try {
          // Alternative seed for pump.fun tokens
          const pumpSeeds = [
            Buffer.from('metadata'),
            new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s').toBuffer(),
            mintPubkey.toBuffer(),
            Buffer.from('edition'),
          ];
          
          const [altMetadataAddress] = await PublicKey.findProgramAddress(
            pumpSeeds,
            new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')
          );
          
          const altMetadataAccount = await connection.getAccountInfo(altMetadataAddress);
          if (altMetadataAccount && altMetadataAccount.data) {
            const metadata = await parseMetadata(altMetadataAccount.data);
            if (metadata && metadata.name && metadata.symbol) {
              return {
                name: metadata.name,
                symbol: metadata.symbol,
                logo: metadata.image || DEFAULT_METADATA.logo,
                mint: mint
              };
            }
          }
        } catch (error) {
          // Silent error - continue
        }
      }
      
      // Final fallback: try to extract any string data from the mint account
      if (mint.includes('pump')) {
        try {
          const mintAccountInfo = await connection.getAccountInfo(mintPubkey);
          if (mintAccountInfo && mintAccountInfo.data) {
            // Try to extract readable strings from mint account data
            const dataString = mintAccountInfo.data.toString('utf8');
            const readableText = dataString.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
            
            if (readableText.length > 0) {
              // This is a very basic extraction - in practice you'd need proper parsing
            }
          }
        } catch (error) {
          // Silent error - continue
        }
      }
      
      
              
        return null;
  } catch (error) {
    console.error(`Error fetching token metadata from blockchain for ${mint}:`, error);
    return null;
  }
};

/**
 * Fetch token metadata from Helius API
 * @param {string} mint - Token mint address
 * @returns {Promise<ITokenMetadata | null>} Token metadata or null if not found
 */
export const getTokenMetadataFromHelius = async (mint: string): Promise<ITokenMetadata | null> => {
  try {
    // Check if Helius API key is configured
    if (!process.env.HELIUS_APIKEY) {
      return null;
    }

    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.HELIUS_APIKEY}`
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: '1',
        method: 'getAsset',
        params: {
          id: mint
        }
      })
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    const response = await fetch('https://mainnet.helius-rpc.com/', {
      ...options,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Helius API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as any;

    // Check if the response contains the expected structure
    if (!data.result || !data.result.content || !data.result.content.metadata) {
      return null;
    }

    const metadata = data.result.content.metadata;
    const links = data.result.content.links;

    // Extract name, symbol, and image
    const name = metadata.name ? String(metadata.name).trim() : null;
    const symbol = metadata.symbol ? String(metadata.symbol).trim() : null;
    const image = validateImageUrl(links?.image);

    // Validate that we have meaningful data
    if (!name || !symbol || name.length === 0 || symbol.length === 0) {
      return null;
    }

    // Additional validation for quality
    const hasValidName = name.length > 0 && name.length <= 100 && 
                        !/^[\x00-\x1f\x7f-\x9f]*$/.test(name);
    const hasValidSymbol = symbol.length > 0 && symbol.length <= 20 && 
                          !/^[\x00-\x1f\x7f-\x9f]*$/.test(symbol) &&
                          !/^[0-9]+$/.test(symbol);

    if (!hasValidName || !hasValidSymbol) {
      return null;
    }

    return {
      name: name,
      symbol: symbol,
      logo: image,
      mint: mint
    };

  } catch (error) {
    // Only log non-timeout and non-network errors to reduce noise
    const errorType = (error as any).name;
    const errorCode = (error as any).code;
    if (errorType !== 'AbortError' && 
        errorCode !== 'ECONNRESET' && 
        errorCode !== 'ENOTFOUND' && 
        errorCode !== 'ECONNREFUSED' &&
        errorType !== 'FetchError') {
      console.error(`Error fetching metadata from Helius for ${mint}:`, error);
    }
    return null;
  }
};

/**
 * Get metadata address for a token mint
 * @param {PublicKey} mint - Token mint public key
 * @param {string} programId - Metadata program ID
 * @returns {Promise<PublicKey>} Metadata address
 */
const getMetadataAddress = async (mint: PublicKey, programId: string = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s'): Promise<PublicKey> => {
  const METADATA_PROGRAM_ID = new PublicKey(programId);
  
  const [metadataAddress] = await PublicKey.findProgramAddress(
    [
      Buffer.from('metadata'),
      METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    METADATA_PROGRAM_ID
  );
  
  return metadataAddress;
};

/**
 * Parse metadata from account data (Metaplex format) with improved error handling
 * @param {Buffer} data - Account data buffer
 * @returns {Promise<any>} Parsed metadata object
 */
const parseMetadata = async (data: Buffer): Promise<any> => {
  try {
    // Ensure we have enough data to read
    if (data.length < 66) {
      return null;
    }
    
    let offset = 1; // Skip account discriminator
    
    // Read key (1 byte) - ensure we don't go out of bounds
    if (offset >= data.length) return null;
    const key = data.readUInt8(offset);
    offset += 1;
    
    // Skip update authority (32 bytes) and mint (32 bytes)
    offset += 64;
    if (offset >= data.length) return null;
    
    // Read name length and validate
    if (offset + 4 > data.length) return null;
    const nameLength = data.readUInt32LE(offset);
    offset += 4;
    
    // Validate name length is reasonable (increased limit for some tokens)
    if (nameLength > 2000 || offset + nameLength > data.length) {
      return null;
    }
    
    const nameBytes = data.slice(offset, offset + nameLength);
    const name = nameBytes.toString('utf8').replace(/\0/g, '').trim();
    offset += nameLength;
    
    // Read symbol length and validate
    if (offset + 4 > data.length) return null;
    const symbolLength = data.readUInt32LE(offset);
    offset += 4;
    
    // Validate symbol length is reasonable
    if (symbolLength > 100 || offset + symbolLength > data.length) {
      return null;
    }
    
    const symbolBytes = data.slice(offset, offset + symbolLength);
    const symbol = symbolBytes.toString('utf8').replace(/\0/g, '').trim();
    offset += symbolLength;
    
    // Read URI length and validate
    if (offset + 4 > data.length) return null;
    const uriLength = data.readUInt32LE(offset);
    offset += 4;
    
    // Validate URI length is reasonable
    if (uriLength > 4000 || offset + uriLength > data.length) {
      return null;
    }
    
    const uriBytes = data.slice(offset, offset + uriLength);
    const uri = uriBytes.toString('utf8').replace(/\0/g, '').trim();
    
    // Enhanced validation for name and symbol
    const isValidName = name && name.length > 0 && name.length <= 100 && 
                       !/^[\x00-\x1f\x7f-\x9f]*$/.test(name);
    const isValidSymbol = symbol && symbol.length > 0 && symbol.length <= 20 && 
                         !/^[\x00-\x1f\x7f-\x9f]*$/.test(symbol) &&
                         !/^[0-9]+$/.test(symbol);
    
    // If we have valid on-chain data, try to fetch URI metadata
    if (uri && (uri.startsWith('http') || uri.startsWith('ar://') || uri.startsWith('ipfs://'))) {
      try {
        const metadataFromUri = await fetchMetadataFromUri(uri, name, symbol);
        if (metadataFromUri && metadataFromUri.name && metadataFromUri.symbol) {
          // Prefer URI metadata but fallback to on-chain if URI data is invalid
          const uriHasValidName = metadataFromUri.name.length > 0 && 
                                 metadataFromUri.name.length <= 100 &&
                                 !/^[\x00-\x1f\x7f-\x9f]*$/.test(metadataFromUri.name);
          const uriHasValidSymbol = metadataFromUri.symbol.length > 0 && 
                                   metadataFromUri.symbol.length <= 20 &&
                                   !/^[\x00-\x1f\x7f-\x9f]*$/.test(metadataFromUri.symbol) &&
                                   !/^[0-9]+$/.test(metadataFromUri.symbol);
          
          if (uriHasValidName && uriHasValidSymbol) {
            return metadataFromUri;
          } else if (isValidName && isValidSymbol) {
                         // Use on-chain data if URI data is invalid
             return {
               name: name,
               symbol: symbol,
               image: metadataFromUri.image || DEFAULT_METADATA.logo
             };
          }
        }
      } catch (error) {
        // Only log non-timeout and non-network errors
        const errorType = (error as any).name;
        const errorCode = (error as any).code;
        if (errorType !== 'AbortError' && 
            errorCode !== 'ECONNRESET' && 
            errorCode !== 'ENOTFOUND' && 
            errorCode !== 'ECONNREFUSED' &&
            errorType !== 'FetchError') {
          console.error('Error fetching URI metadata, falling back to on-chain:', error);
        }
      }
    }
    
         // Return on-chain metadata if available and valid
     if (isValidName && isValidSymbol) {
       return {
         name: name,
         symbol: symbol,
         image: DEFAULT_METADATA.logo
       };
     }
     
     // If we have partial data, try to use it
     if (isValidName || isValidSymbol) {
       return {
         name: isValidName ? name : null,
         symbol: isValidSymbol ? symbol : null,
         image: DEFAULT_METADATA.logo
       };
     }
    
    return null;
  } catch (error) {
    console.error('Error parsing metadata:', error);
    return null;
  }
};

/**
 * Alternative metadata parsing for various token types
 * @param {Buffer} data - Account data buffer
 * @returns {Promise<any>} Parsed metadata object
 */
const parseMetadataAlternative = async (data: Buffer): Promise<any> => {
  try {
    // Convert buffer to string with proper encoding handling
    const dataString = data.toString('utf8');
    
    // Method 1: Look for complete metadata URIs in the data
    const uriPatterns = [
      /https:\/\/[^\s\x00-\x1F\x7F-\x9F"'<>]+/g,
      /ipfs:\/\/[^\s\x00-\x1F\x7F-\x9F"'<>]+/g,
      /ar:\/\/[^\s\x00-\x1F\x7F-\x9F"'<>]+/g,
      /baf[a-z0-9]{45,}/g // IPFS hash patterns
    ];
    
    for (const pattern of uriPatterns) {
      const matches = dataString.match(pattern);
      if (matches) {
        for (const match of matches) {
          try {
            let uri = match;
            
            // Handle different URI formats
            if (uri.startsWith('baf')) {
              uri = `https://ipfs.io/ipfs/${uri}`;
            }
            
            // Try to fetch metadata from this URI
            const metadataFromUri = await fetchMetadataFromUri(uri, '', '');
            if (metadataFromUri && metadataFromUri.name && metadataFromUri.symbol) {
              return metadataFromUri;
            }
          } catch (error) {
            // Continue to next URI
          }
        }
      }
    }
    
    // Method 2: Look for embedded JSON structures
    const jsonPatterns = [
      /{[^}]*"name"[^}]*"symbol"[^}]*}/g,
      /{[^}]*"symbol"[^}]*"name"[^}]*}/g
    ];
    
    for (const pattern of jsonPatterns) {
      const matches = dataString.match(pattern);
      if (matches) {
        for (const match of matches) {
          try {
            const json = JSON.parse(match);
            if (json.name && json.symbol) {
              return {
                name: String(json.name).trim(),
                symbol: String(json.symbol).trim(),
                image: validateImageUrl(json.image)
              };
            }
          } catch (e) {
            // Continue to next match
          }
        }
      }
    }
    
    // Method 3: Look for individual JSON fields
    const nameMatch = dataString.match(/"name"\s*:\s*"([^"]+)"/);
    const symbolMatch = dataString.match(/"symbol"\s*:\s*"([^"]+)"/);
    const imageMatch = dataString.match(/"image"\s*:\s*"([^"]+)"/);
    
    if (nameMatch && symbolMatch) {
      return {
        name: nameMatch[1].trim(),
        symbol: symbolMatch[1].trim(),
        image: validateImageUrl(imageMatch?.[1])
      };
    }
    
    // Method 4: Extract readable strings as fallback
    const readableStrings = [];
    let currentString = '';
    
    for (let i = 0; i < data.length; i++) {
      const byte = data[i];
      
      if (byte === 0 || byte < 32 || byte > 126) {
        if (currentString.length >= 2 && currentString.length <= 50) {
          // Filter out common non-metadata strings
          if (!/^(metadata|update|authority|https?|ipfs|www|com|org|net|io)$/i.test(currentString)) {
            readableStrings.push(currentString.trim());
          }
        }
        currentString = '';
      } else {
        currentString += String.fromCharCode(byte);
      }
    }
    
    // Remove duplicates and empty strings
    const uniqueStrings = [...new Set(readableStrings)].filter(s => s.length > 0);
    
    if (uniqueStrings.length >= 2) {
      return {
        name: uniqueStrings[0],
        symbol: uniqueStrings[1],
        image: DEFAULT_METADATA.logo
      };
    }
    
    return null;
  } catch (error) {
    console.error('Error in alternative metadata parsing:', error);
    return null;
  }
};

/**
 * Fetch metadata from URI with robust handling and multiple fallbacks
 * @param {string} uri - Metadata URI
 * @param {string} fallbackName - Fallback name
 * @param {string} fallbackSymbol - Fallback symbol
 * @returns {Promise<any>} Metadata object
 */
const fetchMetadataFromUri = async (uri: string, fallbackName: string, fallbackSymbol: string): Promise<any> => {
  // Multiple IPFS gateways for fallback
  const ipfsGateways = [
    'https://ipfs.io/ipfs/',
    'https://gateway.pinata.cloud/ipfs/',
    'https://cloudflare-ipfs.com/ipfs/',
    'https://dweb.link/ipfs/',
    'https://ipfs.infura.io/ipfs/',
    'https://gateway.ipfs.io/ipfs/'
  ];

  // Arweave gateways
  const arweaveGateways = [
    'https://arweave.net/',
    'https://gateway.arweave.co/',
    'https://arweave.dev/'
  ];

  const fetchWithRetry = async (fetchUri: string, retries = 1): Promise<any> => {
    for (let i = 0; i <= retries; i++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

        const response = await fetch(fetchUri, {
          signal: controller.signal,
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Solana-Wallet-Backend/1.0',
            'Cache-Control': 'no-cache'
          }
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const text = await response.text();
          
          // Handle potential encoding issues
          const cleanText = text.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
          
          try {
            const json = JSON.parse(cleanText) as any;
            
            // Extract metadata with proper handling of special characters
            const metadata = {
              name: json.name ? String(json.name).trim() : fallbackName,
              symbol: json.symbol ? String(json.symbol).trim() : fallbackSymbol,
              image: validateImageUrl(json.image)
            };
            
            // Handle empty strings
            if (!metadata.name || metadata.name === '') {
              metadata.name = fallbackName;
            }
            if (!metadata.symbol || metadata.symbol === '') {
              metadata.symbol = fallbackSymbol;
            }
            
            return metadata;
          } catch (parseError) {
            // Only log JSON parsing errors, not timeout errors
            if (i === retries) {
              throw parseError;
            }
            continue;
          }
        } else if (i === retries) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
      } catch (error) {
        if (i === retries) {
          throw error;
        }
        // Wait before retry (shorter backoff for background jobs)
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second wait
      }
    }
  };

  try {
    // Handle different URI formats
    let fetchUri = uri;
    
    // Handle Arweave URIs
    if (uri.startsWith('ar://')) {
      const arweaveId = uri.replace('ar://', '');
      
      // Try multiple Arweave gateways
      for (const gateway of arweaveGateways) {
        try {
          const result = await fetchWithRetry(gateway + arweaveId);
          if (result && result.name && result.symbol) {
            return result;
          }
        } catch (error) {
          // Only log non-timeout and non-network errors for Arweave gateways
          const errorType = (error as any).name;
          const errorCode = (error as any).code;
          if (errorType !== 'AbortError' && 
              errorCode !== 'ECONNRESET' && 
              errorCode !== 'ENOTFOUND' && 
              errorCode !== 'ECONNREFUSED' &&
              errorType !== 'FetchError') {
            console.error(`Arweave gateway ${gateway} failed:`, error);
          }
          continue;
        }
      }
    }
    
    // Handle IPFS URIs
    else if (uri.startsWith('ipfs://')) {
      const ipfsHash = uri.replace('ipfs://', '');
      
      // Try multiple IPFS gateways
      for (const gateway of ipfsGateways) {
        try {
          const result = await fetchWithRetry(gateway + ipfsHash);
          if (result && result.name && result.symbol) {
            return result;
          }
        } catch (error) {
          // Only log non-timeout and non-network errors for IPFS gateways
          const errorType = (error as any).name;
          const errorCode = (error as any).code;
          if (errorType !== 'AbortError' && 
              errorCode !== 'ECONNRESET' && 
              errorCode !== 'ENOTFOUND' && 
              errorCode !== 'ECONNREFUSED' &&
              errorType !== 'FetchError') {
            console.error(`IPFS gateway ${gateway} failed:`, error);
          }
          continue;
        }
      }
    }
    
    // Handle direct HTTP/HTTPS URLs
    else if (uri.startsWith('http')) {
      // For regular HTTP URLs, try the original URI
      try {
        const result = await fetchWithRetry(uri);
        if (result && result.name && result.symbol) {
          return result;
        }
              } catch (error) {
          // Only log non-timeout and non-network errors
          const errorType = (error as any).name;
          const errorCode = (error as any).code;
          if (errorType !== 'AbortError' && 
              errorCode !== 'ECONNRESET' && 
              errorCode !== 'ENOTFOUND' && 
              errorCode !== 'ECONNREFUSED' &&
              errorType !== 'FetchError') {
            //console.error('Direct HTTP fetch failed:', error);
          }
        }
      
      // If it's an IPFS URL disguised as HTTP, try extracting the hash
      const ipfsMatch = uri.match(/\/ipfs\/([a-zA-Z0-9]+)/);
      if (ipfsMatch) {
        const ipfsHash = ipfsMatch[1];
        for (const gateway of ipfsGateways) {
          try {
            const result = await fetchWithRetry(gateway + ipfsHash);
            if (result && result.name && result.symbol) {
              return result;
            }
                      } catch (error) {
              // Only log non-timeout and non-network errors for IPFS gateways
              const errorType = (error as any).name;
              const errorCode = (error as any).code;
              if (errorType !== 'AbortError' && 
                  errorCode !== 'ECONNRESET' && 
                  errorCode !== 'ENOTFOUND' && 
                  errorCode !== 'ECONNREFUSED' &&
                  errorType !== 'FetchError') {
                console.error(`IPFS gateway ${gateway} failed for extracted hash:`, error);
              }
              continue;
            }
        }
      }
    }
    
  } catch (error) {
    // Only log non-timeout and non-network errors
    const errorType = (error as any).name;
    const errorCode = (error as any).code;
    if (errorType !== 'AbortError' && 
        errorCode !== 'ECONNRESET' && 
        errorCode !== 'ENOTFOUND' && 
        errorCode !== 'ECONNREFUSED' &&
        errorType !== 'FetchError') {
      console.error('Error fetching metadata from URI:', error);
    }
  }
  
  return {
    name: fallbackName,
    symbol: fallbackSymbol,
    image: DEFAULT_METADATA.logo
  };
};



/**
 * Get token metadata with enhanced flow: Local List -> Blockchain -> Helius enhancement -> Fallback
 * @param {string} mint - Token mint address
 * @param {string} rpcUrl - RPC URL
 * @returns {Promise<ITokenMetadata>} Token metadata
 */
export const getTokenMetadata = async (
  mint: string,
  rpcUrl: string
): Promise<ITokenMetadata> => {
  // Check cache first
  const cachedMetadata = getCacheWithExpiration(mint);
  if (cachedMetadata) {
    return cachedMetadata;
  }
  
  let metadata: ITokenMetadata | null = null;
  
  // Step 0: Check local tokens.json file first
  try {
    metadata = getTokenMetadataFromList(mint);
    if (metadata && metadata.name && metadata.symbol) {
      setCacheWithTimestamp(mint, metadata);
      return metadata;
    }
  } catch (error) {
    // Silent error - continue to blockchain fetch
  }
  
  // Step 1: Try blockchain metadata
  try {
    metadata = await getTokenMetadataFromBlockchain(mint, rpcUrl);
    if (metadata && metadata.name && metadata.symbol) {
      const hasValidName = metadata.name.length > 0 && 
                          !metadata.name.startsWith('Token ') &&
                          metadata.name.length <= 100;
      const hasValidSymbol = metadata.symbol.length > 0 && 
                            metadata.symbol.length <= 20 &&
                            !/^[0-9]+$/.test(metadata.symbol);
      
      if (hasValidName && hasValidSymbol) {
        // Check if image is a placeholder
        const isPlaceholderImage = metadata.logo && metadata.logo.includes('placeholder');
        
        if (isPlaceholderImage) {
          // Try to get better image from Helius
          try {
            const heliusMetadata = await getTokenMetadataFromHelius(mint);
            if (heliusMetadata && heliusMetadata.logo && !heliusMetadata.logo.includes('placeholder')) {
              // Use Helius image with blockchain name/symbol
              const enhancedMetadata = {
                ...metadata,
                logo: heliusMetadata.logo
              };
              setCacheWithTimestamp(mint, enhancedMetadata);
              return enhancedMetadata;
            } else {
              // Use Coinvera logo as fallback
              const fallbackMetadata = {
                ...metadata,
                logo: DEFAULT_METADATA.logo
              };
              setCacheWithTimestamp(mint, fallbackMetadata);
              return fallbackMetadata;
            }
          } catch (heliusError) {
            // Use Coinvera logo as fallback
            const fallbackMetadata = {
              ...metadata,
              logo: DEFAULT_METADATA.logo
            };
            setCacheWithTimestamp(mint, fallbackMetadata);
            return fallbackMetadata;
          }
        }
        
        setCacheWithTimestamp(mint, metadata);
        return metadata;
      }
    }
  } catch (error) {
    // Silent error - continue to Helius
  }
  
  // Step 2: Try Helius if blockchain failed completely
  try {
    const heliusMetadata = await getTokenMetadataFromHelius(mint);
    if (heliusMetadata && heliusMetadata.name && heliusMetadata.symbol) {
      const hasValidName = heliusMetadata.name.length > 0 && 
                          heliusMetadata.name !== 'Unknown' &&
                          heliusMetadata.name.length <= 100;
      const hasValidSymbol = heliusMetadata.symbol.length > 0 && 
                            heliusMetadata.symbol !== 'UNKNOWN' &&
                            heliusMetadata.symbol.length <= 20 &&
                            !/^[0-9]+$/.test(heliusMetadata.symbol);
      
      if (hasValidName && hasValidSymbol) {
        setCacheWithTimestamp(mint, heliusMetadata);
        return heliusMetadata;
      }
    }
  } catch (error) {
    // Silent error - continue to fallback
  }
  
  // Step 3: Use fallback
  const fallbackMetadata = {
    mint: mint,
    name: 'Unknown',
    symbol: 'UNKNOWN',
    logo: DEFAULT_METADATA.logo
  };
  
  setCacheWithTimestamp(mint, fallbackMetadata);
  return fallbackMetadata;
};

/**
 * Generate simple fallback metadata for tokens
 * @param {string} mint - Token mint address
 * @returns {ITokenMetadata} Fallback metadata
 */
const generateFallbackMetadata = (mint: string): ITokenMetadata => {
  return {
    mint: mint,
    name: 'Unknown',
    symbol: 'UNKNOWN',
    logo: DEFAULT_METADATA.logo
  };
};

/**
 * Clear metadata cache (useful for testing or memory management)
 */
export const clearMetadataCache = (): void => {
  metadataCache.clear();
  cacheTimestamps.clear();
};

/**
 * Clean expired cache entries
 */
export const cleanExpiredCache = (): void => {
  const now = Date.now();
  
  for (const [key, timestamp] of cacheTimestamps.entries()) {
    const metadata = metadataCache.get(key);
    if (metadata) {
          // Use different TTL based on whether it's fallback metadata
    const isFallback = metadata.name === 'Unknown' && metadata.symbol === 'UNKNOWN';
      
      const ttl = isFallback ? CACHE_TTL_FALLBACK : CACHE_TTL_SUCCESS;
      
      if (now - timestamp > ttl) {
        metadataCache.delete(key);
        cacheTimestamps.delete(key);
      }
    }
  }
};

/**
 * Get cache size (for monitoring)
 * @returns {number} Number of cached entries
 */
export const getMetadataCacheSize = (): number => {
  return metadataCache.size;
};

/**
 * Enhanced cache set with timestamp tracking
 * @param {string} key - Cache key
 * @param {ITokenMetadata} metadata - Metadata to cache
 */
const setCacheWithTimestamp = (key: string, metadata: ITokenMetadata): void => {
  metadataCache.set(key, metadata);
  cacheTimestamps.set(key, Date.now());
};

/**
 * Enhanced cache get with expiration check
 * @param {string} key - Cache key
 * @returns {ITokenMetadata | undefined} Cached metadata or undefined if expired
 */
const getCacheWithExpiration = (key: string): ITokenMetadata | undefined => {
  const metadata = metadataCache.get(key);
  const timestamp = cacheTimestamps.get(key);
  
  if (!metadata || !timestamp) {
    return undefined;
  }
  
  const now = Date.now();
  const isFallback = metadata.name === 'Unknown' && metadata.symbol === 'UNKNOWN';
  
  const ttl = isFallback ? CACHE_TTL_FALLBACK : CACHE_TTL_SUCCESS;
  
  if (now - timestamp > ttl) {
    metadataCache.delete(key);
    cacheTimestamps.delete(key);
    return undefined;
  }
  
  return metadata;
};

/**
 * Clear cache for specific tokens
 * @param {string[]} mints - Array of token mint addresses to clear from cache
 */
export const clearTokenCache = (mints: string[]): void => {
  mints.forEach(mint => {
    metadataCache.delete(mint);
    cacheTimestamps.delete(mint);
  });
  console.log(`Cleared cache for ${mints.length} tokens`);
};

/**
 * Fetch metadata for multiple tokens efficiently using parallel processing
 * @param {string[]} mints - Array of token mint addresses
 * @param {string} rpcUrl - Solana RPC URL
 * @returns {Promise<ITokenMetadata[]>} Array of token metadata
 */
export const getTokenMetadataBatch = async (
  mints: string[],
  rpcUrl: string
): Promise<ITokenMetadata[]> => {
  if (mints.length === 0) {
    return [];
  }

  try {
    // Create promises for each token with individual error handling
    const metadataPromises = mints.map(async (mint, index) => {
      try {
        // Add a timeout wrapper for individual token fetching (reduced for background jobs)
        const timeoutPromise = new Promise<ITokenMetadata>((_, reject) => {
          setTimeout(() => reject(new Error('Token metadata fetch timeout')), 30000); // 30 seconds
        });

        const metadataPromise = getTokenMetadata(mint, rpcUrl);
        
        // Race between the metadata fetch and timeout
        const metadata = await Promise.race([metadataPromise, timeoutPromise]);
        
        return metadata;
      } catch (error) {
        // Only log non-timeout and non-network errors to reduce noise
        const errorType = (error as any).name;
        const errorCode = (error as any).code;
        if (!(error instanceof Error) || 
            (!error.message.includes('timeout') &&
             errorType !== 'AbortError' && 
             errorCode !== 'ECONNRESET' && 
             errorCode !== 'ENOTFOUND' && 
             errorCode !== 'ECONNREFUSED' &&
             errorType !== 'FetchError')) {
          console.error(`Failed to fetch metadata for token ${mint}:`, error);
        }
        
        // Return fallback metadata for this specific token
        return generateFallbackMetadata(mint);
      }
    });

    // Use Promise.allSettled to handle individual failures gracefully
    const results = await Promise.allSettled(metadataPromises);
    
    // Extract results and provide fallbacks for any failures
    const metadataResults = results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        // Only log non-timeout and non-network errors to reduce noise
        const errorType = (result.reason as any).name;
        const errorCode = (result.reason as any).code;
        if (!(result.reason instanceof Error) || 
            (!result.reason.message.includes('timeout') &&
             errorType !== 'AbortError' && 
             errorCode !== 'ECONNRESET' && 
             errorCode !== 'ENOTFOUND' && 
             errorCode !== 'ECONNREFUSED' &&
             errorType !== 'FetchError')) {
          console.error(`Metadata fetch failed for token ${mints[index]}:`, result.reason);
        }
        return generateFallbackMetadata(mints[index]);
      }
    });

    return metadataResults;
  } catch (error) {
    console.error('Error in batch token metadata fetching:', error);
    
    // Return fallback metadata for all tokens if entire batch fails
    return mints.map(mint => generateFallbackMetadata(mint));
  }
}; 