import { Keypair, PublicKey, Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';

export interface SolanaWalletKeys {
  publicKey: string;
  privateKey: string;
}

/**
 * Get Solana balance for a wallet address
 * @param {string} walletAddress - The wallet address to check balance for
 * @param {string} rpcUrl - The Solana RPC URL
 * @returns {Promise<number>} Balance in SOL
 */
export const getSolanaBalance = async (walletAddress: string, rpcUrl: string): Promise<number> => {
  try {
    if (!walletAddress || !rpcUrl) {
      throw new Error('Wallet address and RPC URL are required');
    }

    // Create connection to Solana network
    const connection = new Connection(rpcUrl, 'processed');
    
    // Create public key from wallet address
    const publicKey = new PublicKey(walletAddress);
    
    // Get balance in lamports
    const balanceInLamports = await connection.getBalance(publicKey, 'processed');
    
    // Convert lamports to SOL
    const balanceInSol = balanceInLamports / LAMPORTS_PER_SOL;
    
    return balanceInSol;
  } catch (error) {
    throw new Error(`Failed to fetch balance: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

/**
 * Generate a new Solana wallet keypair
 * @returns {SolanaWalletKeys} Object containing public and private keys
 */
export const generateSolanaWallet = (): SolanaWalletKeys => {
  try {
    // Generate new keypair
    const keypair = Keypair.generate();
    
    // Get public key as base58 string
    const publicKey = keypair.publicKey.toBase58();
    
    // Get private key as base58 string
    const privateKey = bs58.encode(keypair.secretKey);
    
    return {
      publicKey,
      privateKey
    };
  } catch (error) {
    throw new Error(`Failed to generate Solana wallet: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

/**
 * Validate a Solana public key
 * @param {string} publicKey - The public key to validate
 * @returns {boolean} True if valid, false otherwise
 */
export const isValidSolanaPublicKey = (publicKey: string): boolean => {
  try {
    new PublicKey(publicKey);
    return true;
  } catch {
    return false;
  }
};

/**
 * Validate a Solana private key
 * @param {string} privateKey - The private key to validate (base58 encoded)
 * @returns {boolean} True if valid, false otherwise
 */
export const isValidSolanaPrivateKey = (privateKey: string): boolean => {
  try {
    const secretKey = bs58.decode(privateKey);
    if (secretKey.length !== 64) {
      return false;
    }
    
    // Try to create a keypair from the secret key
    Keypair.fromSecretKey(secretKey);
    return true;
  } catch {
    return false;
  }
};

/**
 * Get public key from private key
 * @param {string} privateKey - The private key (base58 encoded)
 * @returns {string} The corresponding public key
 */
export const getPublicKeyFromPrivateKey = (privateKey: string): string => {
  try {
    const secretKey = bs58.decode(privateKey);
    const keypair = Keypair.fromSecretKey(secretKey);
    return keypair.publicKey.toBase58();
  } catch (error) {
    throw new Error(`Failed to derive public key: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

/**
 * Create a keypair from a private key
 * @param {string} privateKey - The private key (base58 encoded)
 * @returns {Keypair} The Solana keypair
 */
export const createKeypairFromPrivateKey = (privateKey: string): Keypair => {
  try {
    const secretKey = bs58.decode(privateKey);
    return Keypair.fromSecretKey(secretKey);
  } catch (error) {
    throw new Error(`Failed to create keypair: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}; 