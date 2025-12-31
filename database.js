const { Pool } = require('pg');

// Create PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Initialize database table
async function initializeDatabase() {
  const client = await pool.connect();
  
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS game_training_data (
        id SERIAL PRIMARY KEY,
        game_id VARCHAR(255) NOT NULL,
        room_id VARCHAR(255) NOT NULL,
        winner VARCHAR(10),
        total_moves INTEGER,
        mouse_start_col INTEGER,
        game_data JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    console.log('Database table initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
  } finally {
    client.release();
  }
}

// Save game data to database
async function saveGameData(gameData) {
  const client = await pool.connect();
  
  try {
    const query = `
      INSERT INTO game_training_data 
      (game_id, room_id, winner, total_moves, mouse_start_col, game_data)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `;
    
    const values = [
      gameData.game_id,
      gameData.room_id,
      gameData.winner,
      gameData.total_moves,
      gameData.mouse_start_col,
      JSON.stringify(gameData)
    ];
    
    const result = await client.query(query, values);
    console.log(`Game data saved with ID: ${result.rows[0].id}`);
    return result.rows[0].id;
  } catch (error) {
    console.error('Error saving game data:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Get all games for training
async function getAllGames(limit = 1000) {
  const client = await pool.connect();
  
  try {
    const query = `
      SELECT game_data 
      FROM game_training_data 
      ORDER BY created_at DESC 
      LIMIT $1
    `;
    
    const result = await client.query(query, [limit]);
    return result.rows.map(row => row.game_data);
  } catch (error) {
    console.error('Error fetching games:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Get statistics
async function getStatistics() {
  const client = await pool.connect();
  
  try {
    const query = `
      SELECT 
        COUNT(*) as total_games,
        SUM(CASE WHEN winner = 'mouse' THEN 1 ELSE 0 END) as mouse_wins,
        SUM(CASE WHEN winner = 'cats' THEN 1 ELSE 0 END) as cat_wins,
        AVG(total_moves) as avg_moves
      FROM game_training_data
    `;
    
    const result = await client.query(query);
    return result.rows[0];
  } catch (error) {
    console.error('Error fetching statistics:', error);
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  initializeDatabase,
  saveGameData,
  getAllGames,
  getStatistics,
  pool
};
