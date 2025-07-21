# 🔐 Admin System Guide

This guide covers the admin functionality implemented in your Solana Wallet Backend.

## 🚀 Quick Start

### 1. Create Your First Admin User

First, register a regular user account through the API, then promote them to admin:

```bash
# Promote existing user to admin
node src/scripts/createAdmin.js your-email@domain.com
```

### 2. Test Admin Access

```bash
# Login as admin user
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"your-email@domain.com","password":"your-password"}'

# Use the token from login response
export ADMIN_TOKEN="your-jwt-token-here"

# Test admin endpoint
curl -X GET http://localhost:3000/api/admin/system/status \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

## 🛡️ Security Model

### Role Hierarchy
- **`user`**: Regular users (default)
- **`moderator`**: Enhanced permissions (future use)
- **`admin`**: Full system control

### Protection Layers
1. **Authentication**: Must be logged in (`authenticateToken`)
2. **Authorization**: Must have admin role (`requireAdmin`)
3. **Rate Limiting**: 50 requests/15 minutes for admin endpoints
4. **Last Admin Protection**: Cannot demote the last admin user

## 📋 Admin Endpoints

### 🔧 System Management

#### System Status
```bash
GET /api/admin/system/status
```
Get comprehensive status of all background jobs.

#### Job Control - Transaction Monitor
```bash
POST /api/admin/system/transaction-monitor/start
POST /api/admin/system/transaction-monitor/stop
POST /api/admin/system/transaction-monitor/restart
```

#### Job Control - SOL Price Monitoring
```bash
POST /api/admin/system/sol-price/start
POST /api/admin/system/sol-price/stop
POST /api/admin/system/sol-price/refresh
```

#### Job Control - Asset Discovery
```bash
POST /api/admin/system/asset-discovery/start
POST /api/admin/system/asset-discovery/stop
```

#### Job Control - Limit Orders
```bash
POST /api/admin/system/limit-orders/start
POST /api/admin/system/limit-orders/stop
```

#### Job Control - Token Cleanup
```bash
POST /api/admin/system/token-cleanup/start
POST /api/admin/system/token-cleanup/stop
```

#### Heavy Operations
```bash
POST /api/admin/system/sync-all-users
```
⚠️ **Warning**: This processes ALL users' transaction history. Use with caution.

### 👥 User Management

#### List Users
```bash
GET /api/admin/users?page=1&limit=20
```

#### Get User Details
```bash
GET /api/admin/users/:userId
```

#### Ban/Unban Users
```bash
PUT /api/admin/users/:userId/status
Content: {"status": "banned"}  # or "active"
```

#### Change User Roles
```bash
PUT /api/admin/users/:userId/role
Content: {"role": "admin"}  # or "moderator", "user"
```

### 📊 Analytics & Monitoring

#### System Overview
```bash
GET /api/admin/analytics/overview
```
Returns user counts, asset stats, order stats, transaction counts.

#### Transaction Analytics
```bash
GET /api/admin/analytics/transactions?days=7
```
Detailed transaction breakdown for specified period.

#### All Orders View
```bash
GET /api/admin/orders/all?page=1&limit=20
```
View all users' orders (admin oversight).

### 🚨 Emergency Controls

#### Emergency Stop All Jobs
```bash
POST /api/admin/emergency/stop-all-jobs
```
Immediately stops ALL background jobs.

#### Emergency Start All Jobs
```bash
POST /api/admin/emergency/start-all-jobs
```
Starts ALL background jobs.

## 🔒 Security Fixes Implemented

### ❌ Previous Security Issues
- **Any user** could restart system services
- **Any user** could sync all users' data
- **Any user** could access system-level operations

### ✅ Current Security
- **Only admins** can control system services
- **Only admins** can manage users
- **Only admins** can view system-wide analytics
- **Rate limiting** prevents admin endpoint abuse
- **Last admin protection** prevents lockout

## 🎯 Admin-Only vs User Actions

### 🔐 **Admin-Only Actions**
| Action | Endpoint | Risk Level |
|--------|----------|------------|
| Stop/Start Jobs | `/api/admin/system/*` | **CRITICAL** |
| User Management | `/api/admin/users/*` | **HIGH** |
| System Analytics | `/api/admin/analytics/*` | **MEDIUM** |
| Emergency Controls | `/api/admin/emergency/*` | **CRITICAL** |
| Sync All Users | `/api/admin/system/sync-all-users` | **HIGH** |

### ✅ **User Actions** (remain accessible)
| Action | Endpoint | Description |
|--------|----------|-------------|
| Personal Assets | `/api/user/assets` | Own portfolio |
| Personal Orders | `/api/user/orders` | Own limit orders |
| Trading | `/api/user/trade` | Personal trading |
| Transfers | `/api/user/transfer` | Own token transfers |
| Token Operations | `/api/token/*` | Own token burning/closing |
| Market Data | `/api/price/*` | Public price data |

## 🚀 Usage Examples

### Create and Test Admin User

```bash
# 1. Register a regular user first
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Admin User",
    "email": "admin@yourwallet.com", 
    "password": "SecurePassword123"
  }'

# 2. Promote to admin
node src/scripts/createAdmin.js admin@yourwallet.com

# 3. Login as admin
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@yourwallet.com",
    "password": "SecurePassword123"
  }'

# 4. Test admin functionality
export TOKEN="jwt-token-from-login"

curl -X GET http://localhost:3000/api/admin/system/status \
  -H "Authorization: Bearer $TOKEN"
```

### Monitor System Health

```bash
# Check all job statuses
curl -X GET http://localhost:3000/api/admin/system/status \
  -H "Authorization: Bearer $TOKEN"

# Get system analytics
curl -X GET http://localhost:3000/api/admin/analytics/overview \
  -H "Authorization: Bearer $TOKEN"

# Check recent transaction activity
curl -X GET http://localhost:3000/api/admin/analytics/transactions?days=1 \
  -H "Authorization: Bearer $TOKEN"
```

### Emergency Response

```bash
# If system is misbehaving, stop all jobs
curl -X POST http://localhost:3000/api/admin/emergency/stop-all-jobs \
  -H "Authorization: Bearer $TOKEN"

# After fixing issues, restart all jobs
curl -X POST http://localhost:3000/api/admin/emergency/start-all-jobs \
  -H "Authorization: Bearer $TOKEN"
```

### User Management

```bash
# List all users
curl -X GET http://localhost:3000/api/admin/users?page=1&limit=10 \
  -H "Authorization: Bearer $TOKEN"

# Ban a user
curl -X PUT http://localhost:3000/api/admin/users/USER_ID_HERE/status \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "banned"}'

# Promote user to moderator
curl -X PUT http://localhost:3000/api/admin/users/USER_ID_HERE/role \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"role": "moderator"}'
```

## 🔧 Implementation Details

### Middleware Stack
```
authenticateToken → requireAdmin → adminLimiter → route handler
```

### Error Responses
- **401**: Not authenticated
- **403**: Not admin (insufficient permissions)
- **429**: Too many requests (rate limited)
- **400**: Invalid input
- **404**: Resource not found
- **500**: Server error

### Rate Limiting
- **Admin endpoints**: 50 requests / 15 minutes
- **Regular endpoints**: 100 requests / 15 minutes
- **Auth endpoints**: 5 requests / 15 minutes

## 🎯 Best Practices

1. **Create Multiple Admins**: Don't rely on a single admin account
2. **Monitor Admin Actions**: Log admin activities for audit trails
3. **Use Emergency Endpoints Sparingly**: They affect all users
4. **Regular Health Checks**: Monitor `/api/admin/system/status`
5. **Secure Admin Credentials**: Use strong passwords and consider 2FA

## 📱 Frontend Integration

Your frontend should:
1. **Hide admin features** from non-admin users
2. **Show admin dashboard** for admin users
3. **Implement role-based navigation**
4. **Display system status** for admins
5. **Provide user management UI** for admins

## 🔮 Future Enhancements

Consider implementing:
- **Audit logging**: Track all admin actions
- **2FA for admins**: Extra security layer
- **IP whitelisting**: Restrict admin access by IP
- **Admin notifications**: Alert on system issues
- **Bulk operations**: Batch user management
- **Advanced analytics**: More detailed insights

---

## 🆘 Troubleshooting

### Can't Access Admin Endpoints
1. Ensure user is promoted to admin: `node src/scripts/createAdmin.js <email>`
2. Check JWT token includes correct role
3. Verify token isn't expired
4. Check rate limiting

### Jobs Not Responding
1. Check system status: `GET /api/admin/system/status`
2. Try individual job restart: `POST /api/admin/system/*/restart`
3. Use emergency controls if needed
4. Check server logs for errors

Your Solana Wallet Backend is now properly secured with comprehensive admin controls! 🎉 