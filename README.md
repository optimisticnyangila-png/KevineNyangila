# FlowPost - Social Media Automation Platform

## 🚀 Quick Start

### Option 1: Automatic (Recommended)
```bash
npm start
```
This will automatically kill any processes using ports 3000/5000 and start both servers.

### Option 2: Manual Control
```bash
# Kill any existing processes
npx kill-port 3000 5000

# Start servers
npm run start-backend  # Runs on port 5000
npm run start-frontend # Runs on port 3000
```

### Option 3: Windows Batch Script
```bash
start.bat
```

## 🔧 Port Configuration

Both frontend and backend now use environment variables for ports:

- **Frontend**: `PORT=3000` (default)
- **Backend**: `PORT=5000` (default)

You can override by setting environment variables:
```bash
PORT=5000 npm run start-frontend
```

## 🛠️ Development

```bash
# Install all dependencies
npm run install-all

# Development mode (with auto-restart)
npm run dev

# Production mode
npm start
```

## 📁 Project Structure

```
FlowPost/
├── backend/          # Express.js API server
├── frontend/         # Static file server + React app
├── firebase/         # Firebase configuration
├── package.json      # Root scripts and dependencies
└── start.bat         # Windows startup script
```

## 🔒 Environment Variables

Create `.env` files in backend/ and frontend/ directories:

### backend/.env
```
PORT=5000
# Add your Firebase and other secrets here
```

### frontend/.env
```
PORT=3000
```

## 🐛 Troubleshooting

### Port Already in Use
If you get `EADDRINUSE` errors:

```bash
# Kill processes on specific ports
npx kill-port 3000 5000

# Or find and kill manually
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

### Process Still Running
The `npm start` script now automatically kills port conflicts, but if needed:

```bash
# Global kill-port tool
npm install -g kill-port
npx kill-port 3000 5000
```

---

## 🎯 Backend Updates (April 20, 2026)

### ✅ New Features Available

The backend now fully supports the new frontend features:

- ✅ **View Connected Platforms** - GET /platforms
- ✅ **Edit Draft Posts** - PUT /create-post/:id
- ✅ **Delete Draft Posts** - DELETE /create-post/:id
- ✅ **Cancel Scheduled Posts** - DELETE /schedule-post/:id

### 📚 Backend Documentation

See `backend/` folder for comprehensive guides:

| Document | Purpose | Time |
|----------|---------|------|
| **API_SPECIFICATION.md** | Full API reference | 15 min |
| **API_TESTING_GUIDE.js** | Code examples | 10 min |
| **DEPLOYMENT_GUIDE.md** | Deployment steps | 15 min |
| **PRODUCTION_READINESS.md** | Pre-deployment checklist | 20 min |
| **QUICK_REFERENCE.md** | Quick cheat sheet | 5 min |
| **README_UPDATES.md** | Quick start | 5 min |
| **DOCUMENTATION_MAP.md** | Which file to read | 5 min |

### 🚀 Quick Test

```bash
# Start backend
cd backend && npm start

# In another terminal, test
curl http://localhost:5000/platforms \
  -H "Cookie: token=<your_jwt_token>"

# Should respond with:
# { "facebook": true, "instagram": false, "youtube": true, "tiktok": false }
```

### 🔒 Security

- ✅ JWT authentication required on all endpoints
- ✅ User ownership validation (403 if not owner)
- ✅ Input validation on all requests
- ✅ No breaking changes to existing API
- ✅ Production-ready

### 📖 For Developers

**Start here based on your role:**

- **Frontend:** Read [backend/API_SPECIFICATION.md](./backend/API_SPECIFICATION.md)
- **Testing:** Read [backend/API_TESTING_GUIDE.js](./backend/API_TESTING_GUIDE.js)
- **Deployment:** Read [backend/DEPLOYMENT_GUIDE.md](./backend/DEPLOYMENT_GUIDE.md)
- **Not sure?** Read [backend/DOCUMENTATION_MAP.md](./backend/DOCUMENTATION_MAP.md)
