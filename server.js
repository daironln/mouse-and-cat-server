const { createServer } = require("http");
const { Server } = require("socket.io");

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

// Store active rooms
const rooms = new Map();

// Helper to initialize game
function initializeGame(mouseStartCol) {
  const pieces = [];
  
  // Add mouse
  pieces.push({
    id: "mouse",
    type: "mouse",
    position: { row: 0, col: mouseStartCol }
  });
  
  // Add cats at row 7 (all black squares)
  // Row 7 has black squares at columns 0, 2, 4, 6 (since (7+col) % 2 === 1)
  const catCols = [0, 2, 4, 6];
  catCols.forEach((col, index) => {
    pieces.push({
      id: `cat-${index}`,
      type: "cat",
      position: { row: 7, col }
    });
  });
  
  return {
    pieces,
    currentTurn: "mouse",
    winner: null,
    mouseStarted: true
  };
}

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Create room
  socket.on("create-room", (roomId) => {
    socket.join(roomId);
    
    rooms.set(roomId, {
      players: {
        mouse: socket.id,
        cats: null
      },
      gameState: null
    });
    
    socket.emit("room-created", { roomId, role: "mouse" });
    console.log(`Room ${roomId} created by ${socket.id}`);
  });

  // Join room
  socket.on("join-room", (roomId) => {
    const room = rooms.get(roomId);
    
    if (!room) {
      socket.emit("room-error", "Sala no encontrada");
      return;
    }
    
    if (room.players.cats) {
      socket.emit("room-error", "Sala llena");
      return;
    }
    
    socket.join(roomId);
    room.players.cats = socket.id;
    
    socket.emit("room-joined", { roomId, role: "cats" });
    
    // Notify both players that opponent joined
    io.to(roomId).emit("opponent-joined");
    
    // Notify mouse player to select starting position
    io.to(room.players.mouse).emit("select-mouse-start");
    
    console.log(`${socket.id} joined room ${roomId}`);
  });

  // Mouse selects starting position
  socket.on("mouse-start-selected", ({ roomId, col }) => {
    const room = rooms.get(roomId);
    
    if (!room) return;
    
    // Initialize game with mouse starting position
    room.gameState = initializeGame(col);
    
    // Send initial game state to both players
    io.to(roomId).emit("game-state", room.gameState);
    
    console.log(`Game started in room ${roomId} with mouse at col ${col}`);
  });

  // Make move
  socket.on("make-move", ({ roomId, move }) => {
    const room = rooms.get(roomId);
    
    if (!room || !room.gameState) return;
    
    // Validate it's the player's turn
    const currentPlayer = room.gameState.currentTurn;
    const playerId = currentPlayer === "mouse" ? room.players.mouse : room.players.cats;
    
    if (socket.id !== playerId) {
      return; // Not this player's turn
    }
    
    // Update piece position
    const piece = room.gameState.pieces.find(p => p.id === move.pieceId);
    if (piece) {
      piece.position = move.to;
      
      // Switch turn
      room.gameState.currentTurn = currentPlayer === "mouse" ? "cats" : "mouse";
      
      // Send updated game state
      io.to(roomId).emit("game-state", room.gameState);
    }
  });

  // Leave room
  socket.on("leave-room", (roomId) => {
    const room = rooms.get(roomId);
    
    if (room) {
      console.log(`${socket.id} left room ${roomId}`);
      
      // Notify other player
      io.to(roomId).emit("opponent-disconnected");
      
      // Remove the room
      rooms.delete(roomId);
      
      // Leave the socket room
      socket.leave(roomId);
    }
  });

  // Handle disconnect
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    
    // Remove player from any rooms
    for (const [roomId, room] of rooms.entries()) {
      if (room.players.mouse === socket.id || room.players.cats === socket.id) {
        // Notify other player
        io.to(roomId).emit("opponent-disconnected");
        rooms.delete(roomId);
      }
    }
  });
});

const PORT = process.env.PORT || 3001;

httpServer.listen(PORT, () => {
  console.log(`Socket.IO server running on port ${PORT}`);
});
