require('dotenv').config();
const express = require("express");
const cors = require("cors");
const { createServer } = require("http");
const { Server } = require("socket.io");
const { initializeDatabase, saveGameData, getAllGames, getStatistics } = require("./database");

const app = express();
const httpServer = createServer(app);

// Middleware
app.use(cors({
  origin: process.env.CLIENT_URL || "http://localhost:3000"
}));
app.use(express.json());

// Socket.io configuration
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

// Store active rooms
const rooms = new Map();

// Initialize database on startup
initializeDatabase().catch(console.error);

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

// Helper to calculate features for ML
function calculateFeatures(gameState) {
  const mouse = gameState.pieces.find(p => p.type === "mouse");
  const cats = gameState.pieces.filter(p => p.type === "cat");
  
  // Calculate minimum distance from mouse to any cat
  let minDistanceToCat = Infinity;
  cats.forEach(cat => {
    const distance = Math.abs(mouse.position.row - cat.position.row) + 
                     Math.abs(mouse.position.col - cat.position.col);
    minDistanceToCat = Math.min(minDistanceToCat, distance);
  });
  
  // Calculate mouse progress (how close to winning)
  const mouseProgress = mouse.position.row / 7;
  
  // Calculate average cat progress
  const avgCatProgress = cats.reduce((sum, cat) => {
    return sum + (7 - cat.position.row) / 7;
  }, 0) / cats.length;
  
  // Count available moves for mouse
  const mouseValidMoves = getValidMoves(gameState, mouse.id).length;
  
  // Count total available moves for all cats
  const catsValidMoves = cats.reduce((sum, cat) => {
    return sum + getValidMoves(gameState, cat.id).length;
  }, 0);
  
  return {
    mouse_row: mouse.position.row,
    mouse_col: mouse.position.col,
    min_distance_to_cat: minDistanceToCat,
    mouse_progress: mouseProgress,
    avg_cat_progress: avgCatProgress,
    mouse_mobility: mouseValidMoves,
    cats_mobility: catsValidMoves,
    mobility_ratio: mouseValidMoves / (catsValidMoves || 1)
  };
}

// Helper to get valid moves for a piece
function getValidMoves(gameState, pieceId) {
  const piece = gameState.pieces.find(p => p.id === pieceId);
  if (!piece) return [];
  
  const validMoves = [];
  const { row, col } = piece.position;
  
  // Diagonal moves
  const directions = piece.type === "mouse" 
    ? [[-1, -1], [-1, 1], [1, -1], [1, 1]] // Mouse can move forward and backward
    : [[1, -1], [1, 1]]; // Cats can only move forward (down)
  
  directions.forEach(([dRow, dCol]) => {
    const newRow = row + dRow;
    const newCol = col + dCol;
    
    // Check bounds
    if (newRow < 0 || newRow > 7 || newCol < 0 || newCol > 7) return;
    
    // Check if it's a black square
    if ((newRow + newCol) % 2 === 0) return;
    
    // Check if square is occupied
    const occupied = gameState.pieces.some(p => 
      p.position.row === newRow && p.position.col === newCol
    );
    
    if (!occupied) {
      validMoves.push({ row: newRow, col: newCol });
    }
  });
  
  return validMoves;
}

// Helper to check victory conditions
function checkVictory(gameState) {
  const mouse = gameState.pieces.find(p => p.type === "mouse");
  
  // Mouse wins if reaches row 7
  if (mouse.position.row === 7) {
    return "mouse";
  }
  
  // Cats win if mouse has no valid moves
  const mouseValidMoves = getValidMoves(gameState, mouse.id);
  if (mouseValidMoves.length === 0) {
    return "cats";
  }
  
  return null;
}

// Generate unique game ID
function generateGameId() {
  return `game_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
      gameState: null,
      trainingData: {
        game_id: generateGameId(),
        room_id: roomId,
        mouse_start_col: null,
        moves: [],
        states: [],
        winner: null,
        total_moves: 0,
        start_time: Date.now()
      }
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
    room.trainingData.mouse_start_col = col;
    
    // Capture initial state
    const initialFeatures = calculateFeatures(room.gameState);
    room.trainingData.states.push({
      move_number: 0,
      player: "mouse",
      board_state: JSON.parse(JSON.stringify(room.gameState.pieces)),
      features: initialFeatures
    });
    
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
    
    // Capture state before move
    const beforeState = JSON.parse(JSON.stringify(room.gameState.pieces));
    const beforeFeatures = calculateFeatures(room.gameState);
    
    // Update piece position
    const piece = room.gameState.pieces.find(p => p.id === move.pieceId);
    if (piece) {
      const fromPosition = { ...piece.position };
      piece.position = move.to;
      
      // Increment move counter
      room.trainingData.total_moves++;
      
      // Check victory
      const winner = checkVictory(room.gameState);
      if (winner) {
        room.gameState.winner = winner;
        room.trainingData.winner = winner;
      }
      
      // Calculate features after move
      const afterFeatures = calculateFeatures(room.gameState);
      
      // Store move data
      const moveData = {
        move_number: room.trainingData.total_moves,
        player: currentPlayer,
        piece_id: move.pieceId,
        from: fromPosition,
        to: move.to,
        board_state_before: beforeState,
        board_state_after: JSON.parse(JSON.stringify(room.gameState.pieces)),
        features_before: beforeFeatures,
        features_after: afterFeatures,
        valid_moves_before: getValidMoves({ pieces: beforeState }, move.pieceId),
        reward: winner === currentPlayer ? 1 : (winner ? -1 : 0)
      };
      
      room.trainingData.moves.push(moveData);
      room.trainingData.states.push({
        move_number: room.trainingData.total_moves,
        player: currentPlayer,
        board_state: JSON.parse(JSON.stringify(room.gameState.pieces)),
        features: afterFeatures
      });
      
      // If game ended, save to database
      if (winner) {
        room.trainingData.end_time = Date.now();
        room.trainingData.duration_ms = room.trainingData.end_time - room.trainingData.start_time;
        
        console.log(`🏆 Game ended! Winner: ${winner}`);
        console.log(`📊 Saving game data to database...`);
        console.log(`   Game ID: ${room.trainingData.game_id}`);
        console.log(`   Total moves: ${room.trainingData.total_moves}`);
        console.log(`   Duration: ${room.trainingData.duration_ms}ms`);
        
        saveGameData(room.trainingData)
          .then((id) => {
            console.log(`✅ Game ${room.trainingData.game_id} saved to database with ID: ${id}. Winner: ${winner}`);
          })
          .catch(err => {
            console.error('❌ Error saving game data:', err);
            console.error('   Game data:', JSON.stringify(room.trainingData, null, 2));
          });
      }
      
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

// ============================================
// HTTP REST API Endpoints
// ============================================

// Health check
app.get("/", (req, res) => {
  res.json({ 
    status: "ok", 
    message: "Mouse & Cat Training Data Server",
    version: "1.0.0"
  });
});

// Get statistics
app.get("/api/statistics", async (req, res) => {
  try {
    const stats = await getStatistics();
    res.json(stats);
  } catch (error) {
    console.error("Error getting statistics:", error);
    res.status(500).json({ error: "Error fetching statistics" });
  }
});

// Download all training data as JSON
app.get("/api/download-dataset", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10000;
    const games = await getAllGames(limit);
    
    // Set headers for file download
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=training_data_${Date.now()}.json`);
    
    res.json({
      metadata: {
        total_games: games.length,
        exported_at: new Date().toISOString(),
        format_version: "1.0"
      },
      games: games
    });
    
    console.log(`Dataset downloaded: ${games.length} games`);
  } catch (error) {
    console.error("Error downloading dataset:", error);
    res.status(500).json({ error: "Error downloading dataset" });
  }
});

// ============================================
// Start Server
// ============================================

const PORT = process.env.PORT || 3001;

httpServer.listen(PORT, () => {
  console.log(`Socket.IO server running on port ${PORT}`);
});
