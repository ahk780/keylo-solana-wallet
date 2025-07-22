import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export const smtp = {
  host: process.env.SMTP_HOST!,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  user: process.env.SMTP_USER!,
  pass: process.env.SMTP_PASS!,
  fromName: process.env.SMTP_FROM_NAME || 'Keylo',
  fromEmail: process.env.SMTP_FROM_EMAIL || 'no-reply@keylo.io'
};

// Validate SMTP configuration
if (!smtp.host || !smtp.user || !smtp.pass) {
  console.error('❌ SMTP Configuration Error: Missing required environment variables');
  console.error('Required: SMTP_HOST, SMTP_USER, SMTP_PASS');
  throw new Error('Missing required SMTP configuration');
}

console.log('✅ SMTP Configuration loaded successfully'); 