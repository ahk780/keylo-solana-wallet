import { 
  Connection, 
  PublicKey, 
  Transaction as SolanaTransaction, 
  SystemProgram, 
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction
} from '@solana/web3.js';
import { 
  getOrCreateAssociatedTokenAccount, 
  createTransferInstruction, 
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAccount,
  getMint,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction
} from '@solana/spl-token';
import { createKeypairFromPrivateKey } from './solana';

// SOL mint address constant  
export const SOL_MINT = 'So11111111111111111111111111111111111111112';

// Transaction fee in lamports (5000 lamports = 0.000005 SOL)
export const TRANSACTION_FEE = 5000;

export interface TransferResult {
  success: boolean;
  signature?: string;
  error?: string;
}

/**
 * Transfer SOL to another wallet
 * @param {string} privateKey - Sender's private key (base58)
 * @param {string} toAddress - Receiver's wallet address
 * @param {number} amount - Amount in SOL
 * @param {string} rpcUrl - Solana RPC URL
 * @returns {Promise<TransferResult>} Transfer result
 */
export const transferSol = async (
  privateKey: string,
  toAddress: string,
  amount: number,
  rpcUrl: string
): Promise<TransferResult> => {
  try {
    // Create connection
    const connection = new Connection(rpcUrl, 'confirmed');
    
    // Create keypair from private key
    const fromKeypair = createKeypairFromPrivateKey(privateKey);
    const fromPubkey = fromKeypair.publicKey;
    const toPubkey = new PublicKey(toAddress);
    
    // Get sender's balance
    const balance = await connection.getBalance(fromPubkey);
    const amountInLamports = Math.floor(amount * LAMPORTS_PER_SOL);
    
    // Check if sender has enough balance
    if (balance < amountInLamports) {
      return {
        success: false,
        error: 'Insufficient balance'
      };
    }
    
    // If sending all balance, subtract transaction fee
    let transferAmount = amountInLamports;
    if (balance === amountInLamports) {
      transferAmount = amountInLamports - TRANSACTION_FEE;
    }
    
    // Create transfer instruction
    const transferInstruction = SystemProgram.transfer({
      fromPubkey,
      toPubkey,
      lamports: transferAmount,
    });
    
    // Create transaction
    const transaction = new SolanaTransaction().add(transferInstruction);
    
    // Send and confirm transaction
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [fromKeypair],
      { commitment: 'confirmed' }
    );
    
    return {
      success: true,
      signature
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
};

/**
 * Transfer SPL tokens to another wallet
 * @param {string} privateKey - Sender's private key (base58)
 * @param {string} toAddress - Receiver's wallet address
 * @param {string} mintAddress - Token mint address
 * @param {number} amount - Amount in token decimals
 * @param {string} rpcUrl - Solana RPC URL
 * @returns {Promise<TransferResult>} Transfer result
 */
export const transferSplToken = async (
  privateKey: string,
  toAddress: string,
  mintAddress: string,
  amount: number,
  rpcUrl: string
): Promise<TransferResult> => {
  try {
    // Create connection
    const connection = new Connection(rpcUrl, 'confirmed');
    
    // Create keypair from private key
    const fromKeypair = createKeypairFromPrivateKey(privateKey);
    const fromPubkey = fromKeypair.publicKey;
    const toPubkey = new PublicKey(toAddress);
    const mintPubkey = new PublicKey(mintAddress);
    
    // Get mint info to determine decimals
    const mintInfo = await getMint(connection, mintPubkey);
    const transferAmount = Math.floor(amount * Math.pow(10, mintInfo.decimals));
    
    // Get sender's associated token account
    const fromTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      fromKeypair,
      mintPubkey,
      fromPubkey
    );
    
    // Check sender's token balance
    const fromTokenAccountInfo = await getAccount(connection, fromTokenAccount.address);
    if (fromTokenAccountInfo.amount < transferAmount) {
      return {
        success: false,
        error: 'Insufficient token balance'
      };
    }
    
    // Calculate receiver's associated token account address
    const toTokenAccountAddress = getAssociatedTokenAddressSync(
      mintPubkey,
      toPubkey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    
    // Create transaction
    const transaction = new SolanaTransaction();
    
    // Check if receiver's token account exists
    const toTokenAccountInfo = await connection.getAccountInfo(toTokenAccountAddress);
    
    if (!toTokenAccountInfo) {
      // Create associated token account instruction if it doesn't exist
      const createTokenAccountInstruction = createAssociatedTokenAccountInstruction(
        fromPubkey, // payer
        toTokenAccountAddress, // ata
        toPubkey, // owner
        mintPubkey, // mint
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      
      transaction.add(createTokenAccountInstruction);
    }
    
    // Add transfer instruction
    const transferInstruction = createTransferInstruction(
      fromTokenAccount.address,
      toTokenAccountAddress,
      fromPubkey,
      transferAmount,
      [],
      TOKEN_PROGRAM_ID
    );
    
    transaction.add(transferInstruction);
    
    // Send and confirm transaction
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [fromKeypair],
      { commitment: 'confirmed' }
    );
    
    return {
      success: true,
      signature
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
};

/**
 * General transfer function that handles both SOL and SPL tokens
 * @param {string} privateKey - Sender's private key (base58)
 * @param {string} toAddress - Receiver's wallet address
 * @param {string} mintAddress - Token mint address
 * @param {number} amount - Amount to transfer
 * @param {string} rpcUrl - Solana RPC URL
 * @returns {Promise<TransferResult>} Transfer result
 */
export const transfer = async (
  privateKey: string,
  toAddress: string,
  mintAddress: string,
  amount: number,
  rpcUrl: string
): Promise<TransferResult> => {
  try {
    // Validate inputs
    if (!privateKey || !toAddress || !mintAddress || !amount || !rpcUrl) {
      return {
        success: false,
        error: 'Missing required parameters'
      };
    }
    
    if (amount <= 0) {
      return {
        success: false,
        error: 'Amount must be greater than 0'
      };
    }
    
    // Validate addresses
    try {
      new PublicKey(toAddress);
      new PublicKey(mintAddress);
    } catch {
      return {
        success: false,
        error: 'Invalid wallet or mint address'
      };
    }
    
    // Check if it's SOL transfer
    if (mintAddress === SOL_MINT) {
      return await transferSol(privateKey, toAddress, amount, rpcUrl);
    } else {
      return await transferSplToken(privateKey, toAddress, mintAddress, amount, rpcUrl);
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}; 