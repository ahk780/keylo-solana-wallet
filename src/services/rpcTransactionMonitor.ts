import dotenv from 'dotenv';
import { PublicKey, Connection } from '@solana/web3.js';
import { Transaction, SOL_MINT } from '../models/Transaction';
import { User } from '../models/User';
import { getTokenMetadata } from '../utils/tokenMetadata';
import { fetchTokenPrice, extractUsdPrice } from '../utils/priceUtils';
import { getCachedSolPrice } from '../jobs/solPriceJob';

// Load environment variables
dotenv.config();

/**
 * FIXED TRANSACTION PROCESSING:
 * - Transaction type based on SIGNER (not balance direction)
 * - Database storage in chronological order (oldest first) 
 * - Correct amount signs: send (-), receive (+)
 * - DUPLICATION FIX: Prioritize tokens over SOL (ignore SOL fees in token transactions)
 */

// DEX Program IDs for classification - comprehensive list
const DEX_PROGRAMS = {
  'Pump.fun': [
    '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',  // Main Pump.fun program
    'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',  // Pump.fun AMM
    'CE5QSoHhzGGUE8MAfgkWWdDKzKwMDZjCFfvyMDEiKWdj',  // Pump.fun related
    'pumpkn6GrJ5X1KTiRhPWToxrv7wbgx6x7QrePfqzgKA'   // Pump.fun related
  ],
  'Raydium': [
    '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',  // Raydium AMM V4
    'EhYXQPv92L6EUrDBkLyMtq5e1yvfbGzT3H7qUaLDqhd8',  // Raydium Staking
    'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C',  // Raydium CPMM
    '27haf8L6oxUeXrHrgEgsexjSY5hbVUWEmvv9Nyxg8vQv',  // Raydium related
    '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP'   // Raydium related
  ],
  'Jupiter': [
    'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB',  // Jupiter V4
    'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',  // Jupiter V6
    'j1o2qRpjcyUwEvwtcfhEQefh773ZgjxcVRry7LDqg5X',   // Jupiter related
    'JupiterV6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4' // Jupiter V6 alternative
  ],
  'Serum': [
    '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin',  // Serum DEX V3
    'BJ3jrUzddfuSrZHXSCxMbUuqUUaG23jxjE6tLy6QeL2k',  // Serum related
    'EUqojwWA2rd19FZrzeBncJsm38Jm1hEhE3zsmX3bRc2o'   // Serum related
  ],
  'Orca': [
    'DjVE6JNiYqPL2QXyCUUh8rNjHrbz9hXHNYt99MQ59qw1',  // Orca Whirlpool
    '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP',  // Orca Aquafarm
    '82yxjeMsvaURa4MbZZ7WZZHfobirZYkH1zF8fmeGtyaQ'   // Orca related
  ],
  'Meteora': [
    'Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB',  // Meteora Dynamic AMM
    'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo'   // Meteora related
  ],
  'Phoenix': [
    'PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY'   // Phoenix DEX
  ],
  'Lifinity': [
    'EewxydAPCCVuNEyrVN68PuSYdQ7wKn27V9Gjeoi8dy3S'   // Lifinity
  ]
};

// Enhanced transaction data - send, receive, swap, burn, close
interface FilteredTransactionData {
  signature: string;
  slot: number;
  type: 'send' | 'receive' | 'swap' | 'burn' | 'close';
  dex: string;
  mint: string;
  amount: number; // +/- based on direction
  value: number; // USD value
  name: string;
  symbol: string;
  logo: string;
  from: string;
  to: string;
  status: 'confirmed';
  created_at: Date;
  userId: string;
}

// Remove custom price caching - using existing utilities

interface UserLastSignature {
  userId: string;
  walletAddress: string;
  lastSignature: string;
  lastSyncTime: Date;
}

export class RPCTransactionMonitor {
  private connection: Connection;
  private isRunning = false;
  private userLastSignatures = new Map<string, UserLastSignature>();
  // Using existing price utilities instead of custom caching
  
  constructor() {
    const rpcUrl = process.env.SOLANA_RPC_URL;
    
    if (!rpcUrl) {
      throw new Error('SOLANA_RPC_URL environment variable is not set. Please check your .env file.');
    }
    
    if (!rpcUrl.startsWith('http://') && !rpcUrl.startsWith('https://')) {
      throw new Error(`Invalid RPC URL format: ${rpcUrl}. URL must start with http:// or https://`);
    }
    
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  /**
   * Start monitoring all users
   */
  public async startMonitoring(): Promise<void> {
    if (this.isRunning) {
      console.log('⚠️ Transaction monitor already running');
      return;
    }

    try {
      this.isRunning = true;
      console.log('🚀 Starting fast RPC transaction monitoring...');
      
      // Get all active users
      const users = await User.find({ status: 'active' });
      console.log(`📊 Found ${users.length} active users to monitor`);
      
      // Load last signatures from database
      await this.loadLastSignatures(users);
      
      // Perform full sync for users with no previous transactions
      const usersNeedingFullSync = users.filter(user => !this.userLastSignatures.has(user._id));
      if (usersNeedingFullSync.length > 0) {
        for (const user of usersNeedingFullSync) {
          await this.fullSyncUserTransactions(user._id, user.wallet);
          
          // Small delay between users
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      // Start monitoring loop
      this.monitorTransactions();
      
      console.log('✅ Fast RPC transaction monitoring started successfully');
    } catch (error) {
      console.error('❌ Error starting transaction monitoring:', error);
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * Stop monitoring
   */
  public async stopMonitoring(): Promise<void> {
    console.log('🛑 Stopping transaction monitoring...');
    this.isRunning = false;
    console.log('✅ Transaction monitoring stopped');
  }

  /**
   * Main monitoring loop - optimized for speed
   */
  private async monitorTransactions(): Promise<void> {
    let cycleCount = 0;
    
    while (this.isRunning) {
      try {
        const cycleStart = Date.now();
        const users = await User.find({ status: 'active' });
        

        
        // Process users in parallel but with controlled concurrency
        const batchSize = 5; // Process 5 users at a time to avoid overwhelming
        let totalProcessed = 0;
        
        for (let i = 0; i < users.length; i += batchSize) {
          const userBatch = users.slice(i, i + batchSize);
          const promises = userBatch.map(user => this.processUserTransactions(user._id, user.wallet));
          
          try {
            await Promise.all(promises);
            totalProcessed += userBatch.length;
          } catch (error) {
            console.error(`❌ Error processing user batch ${i}-${i + batchSize}:`, error);
          }
          
          // Small delay between batches to prevent overwhelming
          if (i + batchSize < users.length) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
        

        
        // Shorter interval since we're using smaller batches
        await new Promise(resolve => setTimeout(resolve, 3000)); // 3 seconds
        
      } catch (error) {
        console.error('❌ Error in monitoring loop:', error);
        await new Promise(resolve => setTimeout(resolve, 10000)); // Wait longer on error
      }
    }
  }

  /**
   * Process transactions for a single user - MONITORING mode (small batches for real-time)
   */
  private async processUserTransactions(userId: string, walletAddress: string): Promise<void> {
    try {
      const publicKey = new PublicKey(walletAddress);
      const userSig = this.userLastSignatures.get(userId);
      
      // MONITORING mode: small batches for real-time updates
      const options: any = { limit: 5 }; // Very small batches for monitoring
      if (userSig?.lastSignature) {
        options.before = userSig.lastSignature;
      }
      
      // Get signatures
      const signatures = await this.connection.getSignaturesForAddress(publicKey, options);
      
      if (signatures.length === 0) {
        return; // No new transactions
      }
      

      
      // Filter valid signatures and check database existence upfront
      const validSignatures = [];
      for (const sig of signatures) {
        if (sig.err) continue;
        
        // Quick database check to avoid processing existing transactions
        const exists = await Transaction.findOne({ signature: sig.signature });
        if (!exists) {
          validSignatures.push(sig);
        }
      }
      
      if (validSignatures.length === 0) {
        // Update last signature to avoid reprocessing
        this.updateLastSignature(userId, walletAddress, signatures[0].signature);
        return;
      }
      
      // SORT signatures chronologically (OLDEST FIRST) for correct order
      if (validSignatures.length > 1) {
        validSignatures.sort((a, b) => (a.slot || 0) - (b.slot || 0));
      }
      
      // Process transactions
      await this.batchProcessTransactions(userId, validSignatures);
      
      // Update last signature to most recent one processed
      this.updateLastSignature(userId, walletAddress, signatures[0].signature);
      
    } catch (error) {
      console.error(`❌ Error processing user ${userId}:`, error);
    }
  }

  /**
   * Batch process transactions efficiently
   */
  private async batchProcessTransactions(
    userId: string, 
    signatures: any[]
  ): Promise<void> {
    const batchSize = 10; // Larger batches for speed
    let processedCount = 0;
    
    for (let i = 0; i < signatures.length; i += batchSize) {
      const batch = signatures.slice(i, i + batchSize);
      
      try {
        // Create batch RPC request
        const batchRequests = batch.map((sig, index) => ({
          jsonrpc: '2.0',
          id: i + index,
          method: 'getTransaction',
          params: [
            sig.signature,
            {
              encoding: 'jsonParsed',
              commitment: 'confirmed',
              maxSupportedTransactionVersion: 0
            }
          ]
        }));
        
        // Execute batch request
        const response = await fetch((this.connection as any)._rpcEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(batchRequests)
        });
        
        const results = await response.json();
        const batchResults = Array.isArray(results) ? results : [results];
        
        // Process each transaction in parallel
        const processingPromises = batch.map(async (sig, index) => {
          const txResult = batchResults[index];
          
          if (!txResult?.result || txResult.error) {
            return;
          }
          
          // Check if already exists
          const exists = await Transaction.findOne({ signature: sig.signature });
          if (exists) {
            return;
          }
          
          // Parse to filtered data (send, receive, swap, burn, close) - ENHANCED WITH TOKEN OPERATIONS
          const transactions = await this.parseToFilteredTransactions(
            txResult.result, 
            sig.signature,
            userId
          );
          

          
          if (transactions.length > 0) {
            for (const tx of transactions) {
              await this.saveFilteredTransaction(tx);
              processedCount++;
            }
          }
        });
        
        await Promise.all(processingPromises);
        
      } catch (error) {
        console.error(`❌ Error processing batch ${i}:`, error);
      }
    }
    
    if (processedCount > 0) {
  
    }
  }

    /**
 * Parse transaction to filtered data (send, receive, swap, burn, close)
   */
  private async parseToFilteredTransactions(
    transaction: any,
    signature: string,
    userId: string
  ): Promise<FilteredTransactionData[]> {
    try {
      const { blockTime, slot, meta } = transaction;
      
      // Skip failed transactions entirely
      if (meta?.err) {
        return [];
      }
      
      // Get user's wallet address
      const user = await User.findById(userId);
      if (!user) return [];
      
      const walletAddress = user.wallet;
      const results: FilteredTransactionData[] = [];
      
      // Detect DEX from entire transaction
      const dex = this.detectDEX(transaction);
      
      // Parse balance changes
      const tokenChanges = this.parseTokenBalanceChanges(meta, walletAddress);
      const solChange = this.parseSolBalanceChanges(meta, walletAddress);
      
      // Check if we have any balance changes at all
      if (tokenChanges.length === 0 && solChange === 0) {
        return results;
      }
      
      // 🔥 NEW: Check for BURN and CLOSE operations before other processing
      const burnCloseResult = await this.detectBurnAndCloseOperations(transaction, signature, userId, walletAddress, blockTime, slot);
      if (burnCloseResult.length > 0) {
        return burnCloseResult; // Return early - these are special operations
      }
      

      
            // CORRECT transaction classification based on user examples
      // TRANSACTION TYPE: Based on SIGNER, not balance direction
      // - If user is SIGNER → "send" (user initiated transaction)  
      // - If user is NOT SIGNER → "receive" (someone else sent to user)
      // AMOUNT SIGNS: send = negative (-), receive = positive (+)
      // DEX SWAPS: Track what the user SPENT (SOL → tokens = track SOL spent, tokens → SOL = track tokens spent)
      // DATABASE ORDER: Store oldest transactions first (chronological order)
      if (dex !== 'Unknown') {
        // DEX SWAP TRANSACTION
        
        // For swaps: track what the user SPENT (outgoing asset), not what they received
        const allBalanceChanges = [];
        
        // Add token changes
        for (const change of tokenChanges) {
          allBalanceChanges.push({
            mint: change.mint,
            amount: change.amount,
            decimals: change.decimals,
            isSOL: false
          });
        }
        
        // Add SOL changes (if significant) - lowered spam filter
        if (solChange !== 0 && Math.abs(solChange) > 0.0000001) { // Lowered threshold
          allBalanceChanges.push({
            mint: SOL_MINT,
            amount: solChange,
            decimals: 9,
            isSOL: true
          });
        }
        
        // Find what the user SPENT (negative balance change) - this is the primary swap transaction
        const spentAsset = allBalanceChanges.find(change => change.amount < 0);
        
        if (spentAsset) {
          const metadata = spentAsset.isSOL 
            ? { name: 'Solana', symbol: 'SOL', logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png' }
            : await this.getTokenMetadata(spentAsset.mint);
          
          const price = spentAsset.isSOL 
            ? this.getSolPriceUSD() 
            : await this.getTokenPriceUSD(spentAsset.mint);
          
          // Amount should be negative since user spent this asset
          const finalAmount = -Math.abs(spentAsset.amount);
          
          results.push({
            signature,
            slot: slot || 0,
            type: 'swap',
            dex,
            mint: spentAsset.mint,
            amount: finalAmount,
            value: Math.abs(finalAmount) * price,
            name: metadata.name,
            symbol: metadata.symbol,
            logo: metadata.logo,
            from: walletAddress, // User wallet (sender)
            to: (DEX_PROGRAMS as any)[dex]?.[0] || 'Unknown', // DEX program
            status: 'confirmed' as const,
            created_at: new Date((blockTime || Date.now() / 1000) * 1000),
            userId
          });
          

          
        }
        
      } else {
        // REGULAR SEND/RECEIVE TRANSACTION
        
        // Extract actual sender/receiver from transaction
        const { actualFrom, actualTo } = this.extractTransferAddresses(transaction, walletAddress);
        
        // ✅ DUPLICATION FIX: Prioritize tokens over SOL
        // Token transactions often have SOL changes (fees), but we only want ONE record per transaction:
        // - If TOKENS exist → Record token transfer, ignore SOL (fees)  
        // - If NO TOKENS → Record pure SOL transfer
        
        const signer = this.getTransactionSigner(transaction);
        const type: 'send' | 'receive' = signer === walletAddress ? 'send' : 'receive';
        
        if (tokenChanges.length > 0) {
          // TOKEN TRANSACTION: Record token, ignore SOL (fees)
          
          for (const change of tokenChanges) {
            // Amount sign based on transaction type (not balance direction)
            let amount: number;
            if (type === 'receive') {
              amount = Math.abs(change.amount); // User received, amount should be positive
            } else {
              amount = -Math.abs(change.amount); // User sent, amount should be negative
            }
            
            const metadata = await this.getTokenMetadata(change.mint);
            const price = await this.getTokenPriceUSD(change.mint);
            
            results.push({
              signature,
              slot: slot || 0,
              type,
              dex: 'Unknown',
              mint: change.mint,
              amount,
              value: Math.abs(amount) * price,
              name: metadata.name,
              symbol: metadata.symbol,
              logo: metadata.logo,
              from: actualFrom,
              to: actualTo,
              status: 'confirmed' as const,
              created_at: new Date((blockTime || Date.now() / 1000) * 1000),
              userId
            });
            

          }
          
        } else if (solChange !== 0 && Math.abs(solChange) > 0.0000001) {
          // PURE SOL TRANSACTION: No tokens, record SOL
          console.log(`💰 Pure SOL transaction: ${solChange} SOL`);
          
          // Amount sign based on transaction type (not balance direction)
          let amount: number;
          if (type === 'receive') {
            amount = Math.abs(solChange); // User received, amount should be positive
          } else {
            amount = -Math.abs(solChange); // User sent, amount should be negative
          }
          
          const price = this.getSolPriceUSD();
          
          results.push({
            signature,
            slot: slot || 0,
            type,
            dex: 'Unknown',
            mint: SOL_MINT,
            amount,
            value: Math.abs(amount) * price,
            name: 'Solana',
            symbol: 'SOL',
            logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
            from: actualFrom,
            to: actualTo,
            status: 'confirmed' as const,
            created_at: new Date((blockTime || Date.now() / 1000) * 1000),
            userId
          });
          
          
        }
      }
      
      return results;
      
    } catch (error) {
      console.error(`Error parsing transaction ${signature}:`, error);
      return [];
    }
  }

  /**
   * Detect DEX from program IDs - PRIORITY-BASED detection
   */
  private detectDEX(transaction: any): string {
    try {
      const { transaction: tx, meta } = transaction;
      const allProgramIds = new Set<string>();
      const detectedDEXes: string[] = [];
      
      // Get program IDs from instructions (HIGHEST PRIORITY)
      if (tx?.message?.instructions) {
        for (const instruction of tx.message.instructions) {
          if (instruction.programId) {
            allProgramIds.add(instruction.programId);
          }
        }
      }
      
      // Get program IDs from inner instructions (MEDIUM PRIORITY) 
      if (meta?.innerInstructions) {
        for (const innerInstructionGroup of meta.innerInstructions) {
          if (innerInstructionGroup.instructions) {
            for (const innerInstruction of innerInstructionGroup.instructions) {
              if (innerInstruction.programId) {
                allProgramIds.add(innerInstruction.programId);
              }
            }
          }
        }
      }
      
      // Get program IDs from account keys (LOWEST PRIORITY)
      if (tx?.message?.accountKeys) {
        for (const accountKey of tx.message.accountKeys) {
          const addr = typeof accountKey === 'string' ? accountKey : accountKey.pubkey;
          if (addr) {
            allProgramIds.add(addr);
          }
        }
      }
      
      console.log(`🔍 All program IDs found: ${Array.from(allProgramIds).map(id => id.substring(0, 8) + '...').join(', ')}`);
      
      // Check all collected program IDs against DEX programs with PRIORITY
      const dexPriority = ['Jupiter', 'Raydium', 'Orca', 'Serum', 'Meteora', 'Phoenix', 'Lifinity', 'Pump.fun'];
      
      // Collect all detected DEXes
      for (const programId of allProgramIds) {
        for (const [dexName, dexPrograms] of Object.entries(DEX_PROGRAMS)) {
          if (dexPrograms.includes(programId)) {
            detectedDEXes.push(dexName);
            console.log(`🔍 Found DEX program: ${dexName} (${programId})`);
          }
        }
      }
      
      // Return highest priority DEX if multiple found
      if (detectedDEXes.length > 0) {
        for (const priorityDex of dexPriority) {
          if (detectedDEXes.includes(priorityDex)) {
            console.log(`✅ Final DEX selection: ${priorityDex} (from ${detectedDEXes.join(', ')})`);
            return priorityDex;
          }
        }
        // Fallback to first detected
        console.log(`✅ DEX detected (fallback): ${detectedDEXes[0]}`);
        return detectedDEXes[0];
      }
      
      console.log(`❌ No DEX detected from ${allProgramIds.size} program IDs`);
      return 'Unknown';
    } catch (error) {
      console.error('Error detecting DEX:', error);
      return 'Unknown';
    }
  }

  /**
   * Parse token balance changes - CORRECT implementation based on user examples
   */
  private parseTokenBalanceChanges(meta: any, walletAddress: string): Array<{
    mint: string;
    amount: number;
    decimals: number;
  }> {
    try {
      const preBalances = meta?.preTokenBalances || [];
      const postBalances = meta?.postTokenBalances || [];
      const changes: Array<{ mint: string; amount: number; decimals: number }> = [];
      
      console.log(`🔍 Token balance check for ${walletAddress.substring(0, 8)}... - Pre: ${preBalances.length}, Post: ${postBalances.length}`);
      
      // Get all tokens the user has in POST balances (tokens they have after transaction)
      const userPostTokens = postBalances.filter((balance: any) => balance.owner === walletAddress);
      
      for (const postToken of userPostTokens) {
        const mint = postToken.mint;
        const postAmount = parseFloat(postToken.uiTokenAmount.uiAmountString || '0');
        const decimals = postToken.uiTokenAmount.decimals;
        
        // Find pre-balance for the same mint and owner
        const preToken = preBalances.find((balance: any) => 
          balance.mint === mint && balance.owner === walletAddress
        );
        
        const preAmount = preToken ? parseFloat(preToken.uiTokenAmount.uiAmountString || '0') : 0;
        
        // Calculate the change
        const change = postAmount - preAmount;
        
        console.log(`💰 Token ${mint.substring(0, 8)}...: ${preAmount} → ${postAmount} (change: ${change})`);
        
        if (change !== 0) {
          changes.push({
            mint,
            amount: change, // Use uiAmount which is already in human-readable format
            decimals
          });
          console.log(`✅ Added token change: ${mint.substring(0, 8)}... = ${change}`);
        }
      }
      
      // Also check for tokens the user had before but not after (sent away completely)
      const userPreTokens = preBalances.filter((balance: any) => balance.owner === walletAddress);
      
      for (const preToken of userPreTokens) {
        const mint = preToken.mint;
        
        // Skip if we already processed this mint above
        if (userPostTokens.some((post: any) => post.mint === mint)) {
          continue;
        }
        
        const preAmount = parseFloat(preToken.uiTokenAmount.uiAmountString || '0');
        const decimals = preToken.uiTokenAmount.decimals;
        
        // User had tokens before but not after = sent them all away
        const change = -preAmount;
        
        console.log(`💰 Token ${mint.substring(0, 8)}...: ${preAmount} → 0 (change: ${change})`);
        
        if (change !== 0) {
          changes.push({
            mint,
            amount: change,
            decimals
          });
          console.log(`✅ Added token change: ${mint.substring(0, 8)}... = ${change}`);
        }
      }
      
      console.log(`📊 Total token changes: ${changes.length}`);
      return changes;
    } catch (error) {
      console.error('Error parsing token balance changes:', error);
      return [];
    }
  }

  /**
   * Parse SOL balance changes - ENHANCED detection for all transaction types
   */
  private parseSolBalanceChanges(meta: any, walletAddress: string): number {
    try {
  
      
      // Method 1: Check using transaction account keys (most reliable)
      if (meta?.transaction?.message?.accountKeys && meta?.preBalances && meta?.postBalances) {
        const accountKeys = meta.transaction.message.accountKeys;
        console.log(`🔍 Found ${accountKeys.length} account keys, ${meta.preBalances.length} pre-balances, ${meta.postBalances.length} post-balances`);
        
        // Log all account keys for debugging
        accountKeys.forEach((key: any, index: number) => {
          const addr = typeof key === 'string' ? key : (key.pubkey || key);
          console.log(`   Account[${index}]: ${addr.substring(0, 8)}...`);
        });
        
        for (let i = 0; i < accountKeys.length; i++) {
          const accountKey = accountKeys[i];
          const addr = typeof accountKey === 'string' ? accountKey : (accountKey.pubkey || accountKey);
          
          if (addr === walletAddress && i < meta.preBalances.length && i < meta.postBalances.length) {
            const preBalance = meta.preBalances[i] || 0;
            const postBalance = meta.postBalances[i] || 0;
            
            // Raw balance change in lamports
            const balanceChangeLamports = postBalance - preBalance;
            
            // Convert to SOL
            const balanceChangeSOL = balanceChangeLamports / 1000000000;
            

            
            return balanceChangeSOL;
          }
        }
      }
      
      // Method 2: Check using meta.preBalances/postBalances directly (fallback)
      if (meta?.preBalances && meta?.postBalances) {

        
        // Check all balance positions for significant changes
        for (let i = 0; i < Math.min(meta.preBalances.length, meta.postBalances.length); i++) {
          const preBalance = meta.preBalances[i] || 0;
          const postBalance = meta.postBalances[i] || 0;
          const balanceChangeLamports = postBalance - preBalance;
          const balanceChangeSOL = balanceChangeLamports / 1000000000;
          
          // If there's a significant change, this might be our wallet
          if (Math.abs(balanceChangeSOL) > 0.000001) {
            // This is a potential match - let's use it
            return balanceChangeSOL;
          }
        }
      }
      
      return 0;
    } catch (error) {
      console.error('Error parsing SOL balance changes:', error);
      return 0;
    }
  }

  /**
   * Get token metadata with caching
   */
  private async getTokenMetadata(mint: string): Promise<{ name: string; symbol: string; logo: string }> {
    try {
      if (mint === SOL_MINT) {
        return {
          name: 'Solana',
          symbol: 'SOL',
          logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png'
        };
      }
      
      const rpcUrl = (this.connection as any)._rpcEndpoint;
      const metadata = await getTokenMetadata(mint, rpcUrl);
      
      return {
        name: metadata.name || 'Unknown',
        symbol: metadata.symbol || 'UNKNOWN',
        logo: metadata.logo || 'https://www.coinvera.io/logo.png'
      };
    } catch (error) {
      console.error(`Error getting metadata for ${mint}:`, error);
      return {
        name: 'Unknown',
        symbol: 'UNKNOWN',
        logo: 'https://www.coinvera.io/logo.png'
      };
    }
  }

  /**
   * Get token price in USD using existing price utilities
   * Returns 0 if price fetch fails
   */
  private async getTokenPriceUSD(mint: string): Promise<number> {
    try {
      const apiKey = process.env.COINVERA_APIKEY;
      if (!apiKey) {
        console.log(`⚠️ No Coinvera API key available for token ${mint}, using value: $0`);
        return 0;
      }

      const priceResponse = await fetchTokenPrice(mint, apiKey);
      const price = extractUsdPrice(priceResponse);
      
      if (price === 0) {
        console.log(`⚠️ No price available for token ${mint}, using value: $0`);
      }
      
      return price;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Get SOL price in USD using existing SOL price cache
   */
  private getSolPriceUSD(): number {
    try {
      const cachedSolPrice = getCachedSolPrice();
      
      if (cachedSolPrice && cachedSolPrice.solPriceUsd > 0) {
        return cachedSolPrice.solPriceUsd;
      }
      
      return 100; // Fallback price
    } catch (error) {
      return 100; // Fallback price
    }
  }

  /**
   * Get the transaction signer (who initiated/signed the transaction)
   */
  private getTransactionSigner(transaction: any): string {
    try {
      // The transaction signer is typically the first account in accountKeys
      const { transaction: tx } = transaction;
      const accountKeys = tx?.message?.accountKeys || [];
      
      if (accountKeys.length > 0) {
        const signer = typeof accountKeys[0] === 'string' ? accountKeys[0] : accountKeys[0].pubkey;
        return signer;
      }
      
      return 'Unknown';
    } catch (error) {
      console.error('Error getting transaction signer:', error);
      return 'Unknown';
    }
  }

  /**
   * Extract actual sender/receiver addresses for regular transfers (non-DEX)
   */
  private extractTransferAddresses(transaction: any, userWalletAddress: string): { actualFrom: string; actualTo: string } {
    try {
      console.log(`🔍 Extracting transfer addresses for ${userWalletAddress.substring(0, 8)}...`);
      const { meta, transaction: tx } = transaction;
      const accountKeys = tx?.message?.accountKeys || [];
      
      // For SOL transfers, check balance changes
      if (meta?.preBalances && meta?.postBalances && accountKeys.length >= 2) {
        for (let i = 0; i < Math.min(accountKeys.length, meta.preBalances.length, meta.postBalances.length); i++) {
          const addr = typeof accountKeys[i] === 'string' ? accountKeys[i] : accountKeys[i].pubkey;
          if (addr === userWalletAddress) {
            const preBalance = meta.preBalances[i] || 0;
            const postBalance = meta.postBalances[i] || 0;
            const balanceChange = postBalance - preBalance;
            
            if (balanceChange > 0) {
              // User received SOL - find sender (who lost SOL)
              for (let j = 0; j < Math.min(accountKeys.length, meta.preBalances.length, meta.postBalances.length); j++) {
                if (j !== i) {
                  const senderAddr = typeof accountKeys[j] === 'string' ? accountKeys[j] : accountKeys[j].pubkey;
                  const senderPreBalance = meta.preBalances[j] || 0;
                  const senderPostBalance = meta.postBalances[j] || 0;
                  const senderChange = senderPostBalance - senderPreBalance;
                  
                  if (senderChange < 0 && Math.abs(senderChange) > Math.abs(balanceChange)) {
                    // This is likely the sender (lost more due to fees)
                    console.log(`✅ Found sender: ${senderAddr.substring(0, 8)}... (lost ${senderChange / 1000000000} SOL)`);
                    return { actualFrom: senderAddr, actualTo: userWalletAddress };
                  }
                }
              }
              // Fallback: first account is usually sender
              const fallbackSender = typeof accountKeys[0] === 'string' ? accountKeys[0] : accountKeys[0].pubkey;
              return { actualFrom: fallbackSender, actualTo: userWalletAddress };
            } else if (balanceChange < 0) {
              // User sent SOL - find receiver (who gained SOL)
              for (let j = 0; j < Math.min(accountKeys.length, meta.preBalances.length, meta.postBalances.length); j++) {
                if (j !== i) {
                  const receiverAddr = typeof accountKeys[j] === 'string' ? accountKeys[j] : accountKeys[j].pubkey;
                  const receiverPreBalance = meta.preBalances[j] || 0;
                  const receiverPostBalance = meta.postBalances[j] || 0;
                  const receiverChange = receiverPostBalance - receiverPreBalance;
                  
                  if (receiverChange > 0) {
                    // This is likely the receiver
                    console.log(`✅ Found receiver: ${receiverAddr.substring(0, 8)}... (gained ${receiverChange / 1000000000} SOL)`);
                    return { actualFrom: userWalletAddress, actualTo: receiverAddr };
                  }
                }
              }
              // Fallback: second account is usually receiver
              if (accountKeys.length >= 2) {
                const fallbackReceiver = typeof accountKeys[1] === 'string' ? accountKeys[1] : accountKeys[1].pubkey;
                return { actualFrom: userWalletAddress, actualTo: fallbackReceiver };
              }
            }
            break;
          }
        }
      }
      
      // For token transfers, check token balance changes
      const preTokenBalances = meta?.preTokenBalances || [];
      const postTokenBalances = meta?.postTokenBalances || [];
      
      // Find user's token account changes
      const userPreToken = preTokenBalances.find((bal: any) => bal.owner === userWalletAddress);
      const userPostToken = postTokenBalances.find((bal: any) => bal.owner === userWalletAddress);
      
      if (userPostToken && !userPreToken) {
        // User received tokens - find who sent them
        const senderPreToken = preTokenBalances.find((bal: any) => 
          bal.mint === userPostToken.mint && 
          bal.owner !== userWalletAddress &&
          parseFloat(bal.uiTokenAmount.amount) > 0
        );
        
        if (senderPreToken) {
          console.log(`✅ Found token sender: ${senderPreToken.owner.substring(0, 8)}... → user`);
          return { actualFrom: senderPreToken.owner, actualTo: userWalletAddress };
        }
      } else if (userPreToken && (!userPostToken || parseFloat(userPostToken.uiTokenAmount.amount) < parseFloat(userPreToken.uiTokenAmount.amount))) {
        // User sent tokens - find who received them
        const receiverPostToken = postTokenBalances.find((bal: any) => 
          bal.mint === userPreToken.mint && 
          bal.owner !== userWalletAddress &&
          parseFloat(bal.uiTokenAmount.amount) > 0
        );
        
        if (receiverPostToken) {
          console.log(`✅ Found token receiver: user → ${receiverPostToken.owner.substring(0, 8)}...`);
          return { actualFrom: userWalletAddress, actualTo: receiverPostToken.owner };
        }
      }
      
      // Final fallback
      const fallbackFrom = typeof accountKeys[0] === 'string' ? accountKeys[0] : accountKeys[0].pubkey || userWalletAddress;
      const fallbackTo = accountKeys.length >= 2 
        ? (typeof accountKeys[1] === 'string' ? accountKeys[1] : accountKeys[1].pubkey) 
        : 'Unknown';
      
      console.log(`⚠️ Using fallback addresses: ${fallbackFrom.substring(0, 8)}... → ${fallbackTo.substring(0, 8) === 'Unknown' ? 'Unknown' : fallbackTo.substring(0, 8) + '...'}`);
      return { actualFrom: fallbackFrom, actualTo: fallbackTo };
      
    } catch (error) {
      console.error('Error extracting transfer addresses:', error);
      return { actualFrom: userWalletAddress, actualTo: 'Unknown' };
    }
  }

  /**
   * Extract from/to addresses from transaction data - FIXED for DEX swaps
   */
  private extractFromToAddresses(transaction: any, walletAddress: string, dex: string): { from: string; to: string } {
    try {
      // For DEX transactions, use user wallet and DEX program
      if (dex !== 'Unknown') {
        const dexPrograms = (DEX_PROGRAMS as any)[dex];
        if (dexPrograms && dexPrograms.length > 0) {
          return {
            from: walletAddress,
            to: dexPrograms[0] // Primary DEX program
          };
        }
      }
      
      const { meta, transaction: tx } = transaction;
      const accountKeys = tx?.message?.accountKeys || [];
      
      // For regular transfers, try to extract actual addresses
      let fromAddress = walletAddress;
      let toAddress = 'Unknown';
      
      // Look for transfer instructions to find actual recipient
      const instructions = tx?.message?.instructions || [];
      for (const instruction of instructions) {
        if (instruction.parsed?.type === 'transfer') {
          const info = instruction.parsed.info;
          if (info?.source && info?.destination) {
            return {
              from: info.source,
              to: info.destination
            };
          }
        }
      }
      
      // Check inner instructions for transfers
      if (meta?.innerInstructions) {
        for (const innerGroup of meta.innerInstructions) {
          for (const inner of innerGroup.instructions || []) {
            if (inner.parsed?.type === 'transfer') {
              const info = inner.parsed.info;
              if (info?.source && info?.destination) {
                return {
                  from: info.source,
                  to: info.destination
                };
              }
            }
          }
        }
      }
      
      // Try to find the other party from account keys
      if (accountKeys.length >= 2) {
        // Find accounts that aren't the user's wallet and aren't system programs
        const otherAccounts = accountKeys.filter((account: any) => {
          const addr = typeof account === 'string' ? account : account.pubkey;
          return addr !== walletAddress && 
                 addr !== '11111111111111111111111111111111' && // System Program
                 addr !== 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'; // Token Program
        });
        
        if (otherAccounts.length > 0) {
          const otherAccount = otherAccounts[0];
          toAddress = typeof otherAccount === 'string' ? otherAccount : otherAccount.pubkey;
        }
      }
      
      // For SOL transfers, check balance changes to determine direction
      if (meta?.preBalances && meta?.postBalances) {
        const walletIndex = accountKeys.findIndex((key: any) => {
          const addr = typeof key === 'string' ? key : key.pubkey;
          return addr === walletAddress;
        });
        
        if (walletIndex !== -1) {
          const preBalance = meta.preBalances[walletIndex] || 0;
          const postBalance = meta.postBalances[walletIndex] || 0;
          const balanceChange = postBalance - preBalance;
          
          if (balanceChange > 0) {
            // User received, so from is the other party, to is user
            fromAddress = toAddress !== 'Unknown' ? toAddress : 'Unknown';
            toAddress = walletAddress;
          } else {
            // User sent, so from is user, to is other party
            fromAddress = walletAddress;
            // toAddress already set above
          }
        }
      }
      
      return {
        from: fromAddress,
        to: toAddress
      };
      
    } catch (error) {
      console.error('Error extracting from/to addresses:', error);
      return {
        from: walletAddress,
        to: 'Unknown'
      };
    }
  }

  /**
   * Save filtered transaction data to database
   */
  private async saveFilteredTransaction(txData: FilteredTransactionData): Promise<void> {
    try {
      const transaction = new Transaction(txData);
      await transaction.save();
    } catch (error) {
      console.error(`Error saving transaction ${txData.signature}:`, error);
    }
  }

  /**
   * Load last signatures from existing transactions in database
   */
  private async loadLastSignatures(users: any[]): Promise<void> {
    let loadedCount = 0;
    
    for (const user of users) {
      try {
        // Get the most recent transaction by created_at (our timestamp field)
        const lastTx = await Transaction.findOne(
          { userId: user._id },
          { signature: 1, created_at: 1 }, // Only fetch needed fields
          { sort: { created_at: -1 } }
        );
        
        if (lastTx) {
          this.userLastSignatures.set(user._id, {
            userId: user._id,
            walletAddress: user.wallet,
            lastSignature: lastTx.signature,
            lastSyncTime: new Date()
          });
          loadedCount++;
          console.log(`📍 User ${user._id}: Last signature ${lastTx.signature.substring(0, 8)}...`);
        } else {
          console.log(`📍 User ${user._id}: No previous transactions, will fetch all`);
        }
      } catch (error) {
        console.error(`❌ Error loading last signature for user ${user._id}:`, error);
      }
    }
    
    console.log(`✅ Loaded last signatures for ${loadedCount}/${users.length} users`);
  }

  /**
   * Update last signature for user
   */
  private updateLastSignature(userId: string, walletAddress: string, signature: string): void {
    this.userLastSignatures.set(userId, {
      userId,
      walletAddress,
      lastSignature: signature,
      lastSyncTime: new Date()
    });
  }

  /**
   * Manual sync for all users - COMPLETE SYNC (no limits, get ALL transactions)
   */
  public async syncAllUsers(): Promise<void> {
    console.log('🔄 Starting COMPLETE sync for all users...');
    
    const users = await User.find({ status: 'active' });
    console.log(`📊 Found ${users.length} active users to sync`);
    
    // Load existing last signatures from database
    await this.loadLastSignatures(users);
    
    // Process users sequentially to avoid overwhelming RPC
    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      console.log(`🔄 Syncing user ${i + 1}/${users.length}: ${user._id}`);
      
      try {
        await this.fullSyncUserTransactions(user._id, user.wallet);
        
        // Delay between users
        if (i < users.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
      } catch (error) {
        console.error(`❌ Error syncing user ${user._id}:`, error);
      }
    }
    
    console.log('✅ Complete sync finished for all users');
  }

  /**
   * Full sync for a single user - UNLIMITED transaction fetching
   */
  private async fullSyncUserTransactions(userId: string, walletAddress: string): Promise<void> {
    try {
      const publicKey = new PublicKey(walletAddress);
      const userSig = this.userLastSignatures.get(userId);
      
      let allSignatures: any[] = [];
      let before = undefined;
      let fetchCount = 0;
      let totalFetched = 0;
      
      console.log(`📍 Starting UNLIMITED sync for user ${userId}...`);
      if (userSig?.lastSignature) {
        console.log(`📍 Will stop at last known signature: ${userSig.lastSignature.substring(0, 8)}...`);
      } else {
        console.log(`📍 No last known signature - will fetch ALL transaction history`);
      }
      
      console.log(`🎯 Target wallet: ${walletAddress}`);
      
      // Keep fetching until no more signatures OR we reach last known signature
      while (true) {
        const options: any = { limit: 1000 }; // Maximum batch size allowed by Solana RPC
        if (before) {
          options.before = before;
        }
        
        console.log(`📦 Fetching batch ${fetchCount + 1} for user ${userId}...`);
        const signatures = await this.connection.getSignaturesForAddress(publicKey, options);
        
        if (signatures.length === 0) {
          console.log(`📦 No more signatures found for user ${userId} (reached beginning)`);
          break;
        }
        
        console.log(`📦 Fetched ${signatures.length} signatures (batch ${fetchCount + 1})`);
        
        // Log all signatures in this batch
        console.log(`📋 Batch ${fetchCount + 1} signatures:`);
        signatures.forEach((sig, index) => {
          const status = sig.err ? '❌ ERROR' : '✅';
          console.log(`   ${index + 1}. ${status} ${sig.signature} (slot: ${sig.slot})`);
        });
        
        totalFetched += signatures.length;
        
        // Check each signature and stop if we reach the last known one
        let foundLastKnown = false;
        let newSignatures = [];
        
        for (const sig of signatures) {
          if (userSig?.lastSignature && sig.signature === userSig.lastSignature) {
            foundLastKnown = true;
            console.log(`📍 Reached last known signature: ${sig.signature.substring(0, 8)}...`);
            break;
          }
          newSignatures.push(sig);
        }
        
        allSignatures.push(...newSignatures);
        
        if (foundLastKnown) {
          console.log(`✅ Sync complete - reached last known signature`);
          break;
        }
        
        // If we got less than requested, we've reached the end
        if (signatures.length < 1000) {
          console.log(`📦 Reached end of transaction history (got ${signatures.length} < 1000)`);
          break;
        }
        
        // Prepare for next batch
        before = signatures[signatures.length - 1].signature;
        fetchCount++;
        
        // Log progress every 5 batches
        if (fetchCount % 5 === 0) {
          console.log(`📊 Progress: ${fetchCount} batches, ${totalFetched} total fetched, ${allSignatures.length} new signatures`);
        }
        
        // Small delay to avoid overwhelming RPC
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      
      if (allSignatures.length === 0) {
        return;
      }
      
      // Filter out error transactions and check database existence
      const validSignatures = [];
      
      for (const sig of allSignatures) {
        if (sig.err) continue;
        
        const exists = await Transaction.findOne({ signature: sig.signature });
        if (!exists) {
          validSignatures.push(sig);
        }
      }
      
      if (validSignatures.length === 0) {
        if (allSignatures.length > 0) {
          this.updateLastSignature(userId, walletAddress, allSignatures[0].signature);
        }
        return;
      }
      
      // SORT signatures by slot number (OLDEST FIRST) for correct chronological order
      validSignatures.sort((a, b) => (a.slot || 0) - (b.slot || 0));
      
      // Process in smaller batches to avoid memory/performance issues
      const processBatchSize = 25;
      
      for (let i = 0; i < validSignatures.length; i += processBatchSize) {
        const batch = validSignatures.slice(i, i + processBatchSize);
        await this.batchProcessTransactions(userId, batch);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      // Update last signature to the most recent one processed
      if (allSignatures.length > 0) {
        this.updateLastSignature(userId, walletAddress, allSignatures[0].signature);
      }
      

      
    } catch (error) {
      console.error(`❌ Error in full sync for user ${userId}:`, error);
    }
  }

  /**
   * Add new user to monitoring with FULL SYNC
   */
  public async addUser(userId: string, walletAddress: string): Promise<void> {

    
    try {
      // Check for existing last signature in database
      const lastTx = await Transaction.findOne(
        { userId: userId },
        { signature: 1, created_at: 1 },
        { sort: { created_at: -1 } }
      );
      
      if (lastTx) {
        console.log(`📍 Found existing transactions for user ${userId}, last: ${lastTx.signature.substring(0, 8)}...`);
        this.userLastSignatures.set(userId, {
          userId,
          walletAddress,
          lastSignature: lastTx.signature,
          lastSyncTime: new Date()
        });
      }
      
      // Perform FULL sync for new user
      await this.fullSyncUserTransactions(userId, walletAddress);
      
  
    } catch (error) {
      console.error(`❌ Error adding user ${userId}:`, error);
    }
  }

  /**
   * Remove user from monitoring
   */
  public removeUser(userId: string): void {
    this.userLastSignatures.delete(userId);
    console.log(`➖ Removed user ${userId} from monitoring`);
  }

  /**
   * Get monitoring status
   */
  public getStatus(): {
    isRunning: boolean;
    monitoredUsers: number;
    solPriceCached: boolean;
    solPriceAge: number; // Minutes since last update
  } {
    const cachedSolPrice = getCachedSolPrice();
    const solPriceAge = cachedSolPrice && cachedSolPrice.lastUpdated
      ? Math.floor((Date.now() - cachedSolPrice.lastUpdated.getTime()) / 60000)
      : -1;
    
    return {
      isRunning: this.isRunning,
      monitoredUsers: this.userLastSignatures.size,
      solPriceCached: cachedSolPrice !== null,
      solPriceAge
    };
  }

  /**
   * 🔥 NEW: Detect burn and close token account operations
   * @param {any} transaction - The parsed transaction
   * @param {string} signature - Transaction signature
   * @param {string} userId - User ID
   * @param {string} walletAddress - User's wallet address
   * @param {number} blockTime - Transaction timestamp
   * @param {number} slot - Transaction slot
   * @returns {Promise<FilteredTransactionData[]>} Array of burn/close transactions
   */
  private async detectBurnAndCloseOperations(
    transaction: any,
    signature: string,
    userId: string,
    walletAddress: string,
    blockTime: number,
    slot: number
  ): Promise<FilteredTransactionData[]> {
    const results: FilteredTransactionData[] = [];
    const { meta, transaction: tx } = transaction;
    
    try {
      // Get all instructions (main + inner)
      const allInstructions = [];
      
      // Add main instructions
      if (tx?.message?.instructions) {
        allInstructions.push(...tx.message.instructions);
      }
      
      // Add inner instructions
      if (meta?.innerInstructions) {
        for (const innerGroup of meta.innerInstructions) {
          if (innerGroup.instructions) {
            allInstructions.push(...innerGroup.instructions);
          }
        }
      }

      // Check each instruction for burn/close operations
      for (const instruction of allInstructions) {
        const parsed = instruction.parsed;
        if (!parsed || !parsed.type) continue;

        // 🔥 BURN TOKEN DETECTION
        if (parsed.type === 'burn' && parsed.info) {
          const { account, amount, mint } = parsed.info;
          
          // Verify this is the user's token account being burned
          if (account && mint && amount) {
            // Get token metadata
            const metadata = await this.getTokenMetadata(mint);
            const price = await this.getTokenPriceUSD(mint);
            
            // Parse amount with proper decimals (amount is already in raw format)
            const tokenChanges = this.parseTokenBalanceChanges(meta, walletAddress);
            const relevantChange = tokenChanges.find(change => change.mint === mint);
            const decimals = relevantChange?.decimals || 0;
            const humanAmount = parseInt(amount) / Math.pow(10, decimals);

            results.push({
              signature,
              slot: slot || 0,
              type: 'burn',
              dex: 'Token Program', // Burn is done via Token Program
              mint,
              amount: -Math.abs(humanAmount), // Always negative (tokens destroyed)
              value: Math.abs(humanAmount) * price,
              name: metadata.name,
              symbol: metadata.symbol,
              logo: metadata.logo,
              from: walletAddress, // User's wallet
              to: '11111111111111111111111111111111', // Burned tokens go to system program (null)
              status: 'confirmed' as const,
              created_at: new Date((blockTime || Date.now() / 1000) * 1000),
              userId
            });
          }
        }

        // 🔥 CLOSE TOKEN ACCOUNT DETECTION  
        if (parsed.type === 'closeAccount' && parsed.info) {
          const { account, destination } = parsed.info;
          
          // Verify this is the user's account being closed and rent goes to user
          if (account && destination === walletAddress) {
            // Parse SOL balance change to get rent amount
            const solChange = this.parseSolBalanceChanges(meta, walletAddress);
            const rentAmount = Math.abs(solChange); // Rent recovery is positive
            
            // For close operations, we need to identify which token was closed
            // Look for the mint from token balance changes or pre-transaction state
            const tokenChanges = this.parseTokenBalanceChanges(meta, walletAddress);
            let closedMint = 'Unknown';
            let metadata = { name: 'Unknown Token', symbol: 'UNKNOWN', logo: 'https://www.coinvera.io/logo.png' };
            
            // If there were token changes, use that mint
            if (tokenChanges.length > 0) {
              closedMint = tokenChanges[0].mint;
              metadata = await this.getTokenMetadata(closedMint);
            }

            results.push({
              signature,
              slot: slot || 0,
              type: 'close',
              dex: 'Token Program', // Close is done via Token Program
              mint: closedMint, // The token that was closed
              amount: rentAmount, // Positive rent recovery in SOL
              value: rentAmount * this.getSolPriceUSD(), // Value in USD
              name: `${metadata.name} Account Close`,
              symbol: 'SOL', // Rent recovered in SOL
              logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
              from: '11111111111111111111111111111111', // System program (rent source)
              to: walletAddress, // User receives rent
              status: 'confirmed' as const,
              created_at: new Date((blockTime || Date.now() / 1000) * 1000),
              userId
            });
          }
        }
      }

      return results;
    } catch (error) {
      console.error('Error detecting burn/close operations:', error);
      return results;
    }
  }
}

export const rpcTransactionMonitor = new RPCTransactionMonitor(); 