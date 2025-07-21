const mongoose = require('mongoose');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Simple User schema (just what we need for this script)
const userSchema = new mongoose.Schema({
  email: String,
  role: String
});

const User = mongoose.model('User', userSchema);

async function createFirstAdmin() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      console.error('❌ MONGODB_URI not found in environment variables');
      process.exit(1);
    }

    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    // Get email from command line argument
    const email = process.argv[2];
    if (!email) {
      console.error('❌ Please provide email address as argument');
      console.log('Usage: node createAdmin.js <email@example.com>');
      process.exit(1);
    }

    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      console.error(`❌ User with email "${email}" not found`);
      console.log('Make sure the user has registered first');
      process.exit(1);
    }

    // Check if already admin
    if (user.role === 'admin') {
      console.log(`✅ User "${email}" is already an admin`);
      process.exit(0);
    }

    // Update user role to admin
    await User.findByIdAndUpdate(user._id, { role: 'admin' });
    
    console.log(`🎉 Successfully promoted "${email}" to admin!`);
    console.log('Admin endpoints are now available at:');
    console.log('- GET /api/admin/system/status');
    console.log('- GET /api/admin/users');
    console.log('- GET /api/admin/analytics/overview');
    console.log('- And more...');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
}

createFirstAdmin(); 