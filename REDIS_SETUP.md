# Redis Setup Guide for FlowPost

## Option 1: Windows Subsystem for Linux (WSL) - Recommended
This is the easiest way to run Redis on Windows.

### Prerequisites:
- Windows 10 or 11 with WSL2 enabled
- Ubuntu installed in WSL

### Installation Steps:

1. **Open WSL Terminal** and run:
```bash
sudo apt update
sudo apt install -y redis-server
```

2. **Start Redis Server**:
```bash
redis-server
```
Or run as a background service:
```bash
sudo service redis-server start
```

3. **Test Redis Connection**:
```bash
redis-cli ping
# Should return: PONG
```

Redis will be available at: `127.0.0.1:6379`

---

## Option 2: Docker - Alternative
If you have Docker Desktop installed:

1. **Pull Redis Image**:
```bash
docker pull redis:latest
```

2. **Run Redis Container**:
```bash
docker run -d -p 6379:6379 --name flowpost-redis redis:latest
```

3. **Test Connection**:
```bash
docker exec flowpost-redis redis-cli ping
```

---

## Option 3: Cloud Service - Redis Cloud
Use the managed cloud service for production:

1. **Go to**: https://redis.com/cloud/ (free tier available)
2. **Create Account** and set up a free database
3. **Get Connection String** (format: `redis://default:password@host:port`)
4. **Update `.env`** with connection details

---

## Verifying Redis Installation

### Test from Node.js:
```bash
cd backend
node -e "const Redis = require('ioredis'); const r = new Redis(); r.ping().then(() => console.log('✅ Redis connected!'));"
```

---

## Environment Variables

Add these to your `.env` file:

```env
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
```

For Redis Cloud:
```env
REDIS_URL=redis://default:your-password@your-host:your-port
```

---

## Troubleshooting

### "Connection refused" Error:
- Check if Redis is running
- Verify host and port in `.env`
- Check firewall settings

### "ECONNREFUSED" Error:
- Ensure Redis server is started
- Test with: `redis-cli -h 127.0.0.1 -p 6379 ping`

### Port Already in Use:
- Change port in `.env` to 6380 or 6381
- Or: `lsof -i :6379` to find what's using it
