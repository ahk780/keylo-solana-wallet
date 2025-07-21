import { 
  Connection, 
  PublicKey, 
  Transaction as SolanaTransaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL
} from '@solana/web3.js';
import { 
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createBurnInstruction,
  createCloseAccountInstruction,
  getAccount,
  getMint,
  TokenAccountNotFoundError
} from '@solana/spl-token';
import { createKeypairFromPrivateKey } from './solana';
import { SOL_MINT } from './transfer';
import { getTokenMetadata } from './tokenMetadata';

export interface TokenOperationResult {
  success: boolean;
  signature?: string;
  error?: string;
}

export interface EmptyTokenAccount {
  mint: string;
  name: string;
  symbol: string;
  logo: string;
  token_account: string;
  rent: number; // Amount in SOL that can be recovered
}

/**
 * Burn SPL tokens from user's account
 * @param {string} privateKey - User's private key (base58)
 * @param {string} mintAddress - Token mint address
 * @param {number} amount - Amount to burn (in token units, not raw amount)
 * @param {string} rpcUrl - Solana RPC URL
 * @returns {Promise<TokenOperationResult>} Operation result
 */
export const burnTokens = async (
  privateKey: string,
  mintAddress: string,
  amount: number,
  rpcUrl: string
): Promise<TokenOperationResult> => {
  try {
    // Prevent burning native SOL
    if (mintAddress === SOL_MINT) {
      return {
        success: false,
        error: 'Cannot burn native SOL tokens'
      };
    }

    // Create connection and keypair
    const connection = new Connection(rpcUrl, 'confirmed');
    const ownerKeypair = createKeypairFromPrivateKey(privateKey);
    const mint = new PublicKey(mintAddress);

    // Get mint info for decimals
    const mintInfo = await getMint(connection, mint);
    const burnAmount = BigInt(Math.floor(amount * Math.pow(10, mintInfo.decimals)));

    // Get user's token account
    const tokenAccount = getAssociatedTokenAddressSync(
      mint,
      ownerKeypair.publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    // Check if token account exists and get balance
    try {
      const tokenAccountInfo = await getAccount(connection, tokenAccount);
      
      if (tokenAccountInfo.amount < burnAmount) {
        return {
          success: false,
          error: `Insufficient token balance. Available: ${Number(tokenAccountInfo.amount) / Math.pow(10, mintInfo.decimals)}, Required: ${amount}`
        };
      }
    } catch (error) {
      if (error instanceof TokenAccountNotFoundError) {
        return {
          success: false,
          error: 'Token account not found'
        };
      }
      throw error;
    }

    // Create burn instruction
    const burnInstruction = createBurnInstruction(
      tokenAccount,
      mint,
      ownerKeypair.publicKey,
      burnAmount,
      [],
      TOKEN_PROGRAM_ID
    );

    // Create and send transaction
    const transaction = new SolanaTransaction().add(burnInstruction);
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [ownerKeypair],
      { commitment: 'confirmed' }
    );

    return {
      success: true,
      signature
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
};

/**
 * Close an empty SPL token account and recover rent
 * @param {string} privateKey - User's private key (base58)
 * @param {string} mintAddress - Token mint address
 * @param {string} rpcUrl - Solana RPC URL
 * @returns {Promise<TokenOperationResult>} Operation result
 */
export const closeTokenAccount = async (
  privateKey: string,
  mintAddress: string,
  rpcUrl: string
): Promise<TokenOperationResult> => {
  try {
    // Prevent closing native SOL account
    if (mintAddress === SOL_MINT) {
      return {
        success: false,
        error: 'Cannot close native SOL account'
      };
    }

    // Create connection and keypair
    const connection = new Connection(rpcUrl, 'confirmed');
    const ownerKeypair = createKeypairFromPrivateKey(privateKey);
    const mint = new PublicKey(mintAddress);

    // Get user's token account
    const tokenAccount = getAssociatedTokenAddressSync(
      mint,
      ownerKeypair.publicKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    // Get mint info for decimals
    const mintInfo = await getMint(connection, mint);

    // Check if token account exists and verify it's empty
    try {
      const tokenAccountInfo = await getAccount(connection, tokenAccount);
      
      if (tokenAccountInfo.amount > 0) {
        const humanReadableBalance = Number(tokenAccountInfo.amount) / Math.pow(10, mintInfo.decimals);
        return {
          success: false,
          error: `Token account has non-zero balance: ${humanReadableBalance}. Wallet: ${ownerKeypair.publicKey.toBase58()}, Token Account: ${tokenAccount.toBase58()}. Please burn or transfer tokens first.`
        };
      }
    } catch (error) {
      if (error instanceof TokenAccountNotFoundError) {
        return {
          success: false,
          error: 'Token account not found or already closed'
        };
      }
      throw error;
    }

    // Create close account instruction
    const closeInstruction = createCloseAccountInstruction(
      tokenAccount,
      ownerKeypair.publicKey, // destination (rent goes back to owner)
      ownerKeypair.publicKey, // owner
      [],
      TOKEN_PROGRAM_ID
    );

    // Create and send transaction
    const transaction = new SolanaTransaction().add(closeInstruction);
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [ownerKeypair],
      { commitment: 'confirmed' }
    );

    return {
      success: true,
      signature
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    };
  }
};

/**
 * Get all empty token accounts for a user
 * @param {string} walletAddress - User's wallet address
 * @param {string} rpcUrl - Solana RPC URL
 * @returns {Promise<EmptyTokenAccount[]>} Array of empty token accounts
 */
export const getEmptyTokenAccounts = async (
  walletAddress: string,
  rpcUrl: string
): Promise<EmptyTokenAccount[]> => {
  try {
    const connection = new Connection(rpcUrl, 'confirmed');
    const owner = new PublicKey(walletAddress);

    // Get all token accounts owned by the user
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      owner,
      { programId: TOKEN_PROGRAM_ID }
    );

    const emptyAccounts: EmptyTokenAccount[] = [];

    // Standard rent for token accounts (approximately 0.00203928 SOL)
    const RENT_PER_TOKEN_ACCOUNT = 2039280; // lamports

    for (const tokenAccount of tokenAccounts.value) {
      const parsedInfo = tokenAccount.account.data.parsed?.info;
      if (parsedInfo && parsedInfo.tokenAmount?.uiAmount === 0) {
        const mint = parsedInfo.mint;
        
        // Skip native SOL accounts
        if (mint === SOL_MINT) {
          continue;
        }

        try {
          // Get token metadata
          const metadata = await getTokenMetadata(mint, rpcUrl);
          
          emptyAccounts.push({
            mint: mint,
            name: metadata.name,
            symbol: metadata.symbol,
            logo: metadata.logo,
            token_account: tokenAccount.pubkey.toBase58(),
            rent: RENT_PER_TOKEN_ACCOUNT / LAMPORTS_PER_SOL // Convert to SOL
          });
        } catch (error) {
          // If metadata fetch fails, still include the account with basic info
          emptyAccounts.push({
            mint: mint,
            name: 'Unknown Token',
            symbol: 'UNKNOWN',
            logo: 'https://www.coinvera.io/logo.png',
            token_account: tokenAccount.pubkey.toBase58(),
            rent: RENT_PER_TOKEN_ACCOUNT / LAMPORTS_PER_SOL
          });
        }
      }
    }

    return emptyAccounts;
  } catch (error) {
    console.error('Error getting empty token accounts:', error);
    return [];
  }
};

/**
 * Get token account rent amount for a specific account
 * @param {string} tokenAccountAddress - Token account address
 * @param {string} rpcUrl - Solana RPC URL
 * @returns {Promise<number>} Rent amount in SOL
 */
export const getTokenAccountRent = async (
  tokenAccountAddress: string,
  rpcUrl: string
): Promise<number> => {
  try {
    const connection = new Connection(rpcUrl, 'confirmed');
    const tokenAccount = new PublicKey(tokenAccountAddress);
    
    // Get account info to determine rent
    const accountInfo = await connection.getAccountInfo(tokenAccount);
    
    if (!accountInfo) {
      return 0;
    }

    // Token accounts typically have the same rent amount
    // This is the actual rent stored in the account
    return accountInfo.lamports / LAMPORTS_PER_SOL;
  } catch (error) {
    console.error('Error getting token account rent:', error);
    return 0.00203928; // Default token account rent
  }
}; 