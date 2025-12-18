# Mouse and Cat Game - WebSocket Server

Socket.io server for the multiplayer board game "El Gato y el Ratón".

## 🚀 Quick Start

### Install dependencies
```bash
npm install
```

### Run the server
```bash
npm start
```

The server will start on port 10000 (or the PORT environment variable).

## 🔧 Environment Variables

- `PORT` - Server port (default: 3001, production: 10000)
- `CLIENT_URL` - Allowed CORS origin (your frontend URL)

## 📦 Production Deployment

This server is designed to be deployed on Render.com:

1. Push this repository to GitHub
2. Create a new Web Service on Render
3. Connect your GitHub repository
4. Set environment variables:
   - `PORT`: 10000
   - `CLIENT_URL`: Your Vercel frontend URL
5. Deploy!

## 🎮 Game Server Features

- Real-time multiplayer via WebSocket
- Room-based game sessions (6-digit codes)
- Turn-based move validation
- Game state synchronization
- Player disconnect handling

## 🔗 Related

Frontend repository: https://github.com/daironln/mouse-and-cat
