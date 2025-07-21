import CryptoJS from 'crypto-js';

/**
 * Encrypt a private key using AES encryption
 * @param {string} privateKey - The private key to encrypt
 * @param {string} encryptionKey - The encryption key from environment variables
 * @returns {string} The encrypted private key
 */
export const encryptPrivateKey = (privateKey: string, encryptionKey: string): string => {
  try {
    if (!privateKey || !encryptionKey) {
      throw new Error('Private key and encryption key are required');
    }

    // Encrypt the private key using AES
    const encrypted = CryptoJS.AES.encrypt(privateKey, encryptionKey).toString();
    
    if (!encrypted) {
      throw new Error('Failed to encrypt private key');
    }

    return encrypted;
  } catch (error) {
    throw new Error(`Encryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

/**
 * Decrypt a private key using AES decryption
 * @param {string} encryptedPrivateKey - The encrypted private key
 * @param {string} encryptionKey - The encryption key from environment variables
 * @returns {string} The decrypted private key
 */
export const decryptPrivateKey = (encryptedPrivateKey: string, encryptionKey: string): string => {
  try {
    if (!encryptedPrivateKey || !encryptionKey) {
      throw new Error('Encrypted private key and encryption key are required');
    }

    // Decrypt the private key using AES
    const decrypted = CryptoJS.AES.decrypt(encryptedPrivateKey, encryptionKey);
    const decryptedString = decrypted.toString(CryptoJS.enc.Utf8);
    
    if (!decryptedString) {
      throw new Error('Failed to decrypt private key - invalid key or corrupted data');
    }

    return decryptedString;
  } catch (error) {
    throw new Error(`Decryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

/**
 * Validate if a string is a valid encrypted private key
 * @param {string} encryptedPrivateKey - The encrypted private key to validate
 * @returns {boolean} True if valid, false otherwise
 */
export const isValidEncryptedPrivateKey = (encryptedPrivateKey: string): boolean => {
  try {
    // Basic validation - check if it's a non-empty string
    if (!encryptedPrivateKey || typeof encryptedPrivateKey !== 'string') {
      return false;
    }

    // Check if it's a valid base64 string (CryptoJS AES output)
    const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
    return base64Regex.test(encryptedPrivateKey);
  } catch {
    return false;
  }
};

/**
 * Generate a random encryption key (for development purposes)
 * @param {number} length - The length of the key (default: 32)
 * @returns {string} A random encryption key
 */
export const generateEncryptionKey = (length: number = 32): string => {
  try {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    return result;
  } catch (error) {
    throw new Error(`Failed to generate encryption key: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}; 