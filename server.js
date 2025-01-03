const express = require('express');
const path = require('path');
const Pusher = require('pusher');
const cors = require('cors');

const app = express();

// CORS configuration
const corsOptions = {
    origin: ['https://borderland-sigma.vercel.app', 'http://localhost:3000'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    credentials: true,
    optionsSuccessStatus: 204
};

// Apply CORS middleware before any routes
app.use(cors(corsOptions));

// Parse JSON bodies
app.use(express.json());

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Initialize Pusher with correct configuration
const pusher = new Pusher({
    appId: "1919360",
    key: "e6a64e50330db39ab319",
    secret: "7e060c9a72e6db5311a6",
    cluster: "us2",
    useTLS: true,
    host: 'api-us2.pusher.com',
    port: 443
});

// Game state storage
const rooms = new Map();
const games = new Map();

// Create a new room
app.post('/create-room', (req, res) => {
    const { roomId } = req.body;
    
    if (rooms.has(roomId)) {
        return res.status(400).json({ error: 'Room already exists' });
    }

    rooms.set(roomId, {
        players: [],
        gameStarted: false
    });

    // Test Pusher connection
    pusher.trigger('my-channel', 'my-event', {
        message: `Room ${roomId} created`
    }).then(() => {
        console.log('Pusher event sent successfully');
    }).catch(err => {
        console.error('Pusher event error:', err);
    });

    res.json({ roomId });
});

// Join a room
app.post('/join-room', (req, res) => {
    const { roomId } = req.body;
    console.log(`Attempting to join room ${roomId}`);

    // Validate room ID
    if (!roomId || roomId < 1 || roomId > 9999) {
        return res.status(400).json({ error: 'Invalid room ID' });
    }

    // Create room if it doesn't exist
    if (!rooms.has(roomId)) {
        rooms.set(roomId, {
            id: roomId,
            players: [],
            gameStarted: false,
            currentRound: 0,
            roundResults: [],
            submittedNumbers: new Set(),
            chatMessages: []
        });
        console.log(`Created new room ${roomId}`);
    }

    const room = rooms.get(roomId);

    // Check if game has already started
    if (room.gameStarted) {
        return res.status(200).json({
            roomId,
            gameStarted: true
        });
    }

    // Return room state
    res.json({
        roomId,
        gameStarted: room.gameStarted,
        players: room.players.map(player => ({
            name: player.name,
            spotIndex: player.spotIndex,
            isBot: player.isBot
        }))
    });
});

// Join game in a room
app.post('/join', async (req, res) => {
    const { roomId, playerName, spotIndex, isBot = false } = req.body;
    const room = rooms.get(roomId);

        if (!room) {
        return res.status(404).json({ error: 'Room not found' });
    }

    if (room.players.some(p => p.spotIndex === spotIndex)) {
        return res.status(400).json({ error: 'Spot already taken' });
    }

    const playerId = `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const player = {
            id: playerId,
            name: playerName,
        spotIndex,
        isBot,
        points: 0
    };

    room.players.push(player);

    try {
        // Notify all clients in the room
        await pusher.trigger(`game-channel-${roomId}`, 'waiting-room-update', {
            players: room.players
        });
        console.log('Pusher event sent successfully');
        res.json({ playerId });
    } catch (err) {
        console.error('Pusher event error:', err);
        res.status(500).json({ error: 'Failed to send update' });
    }
});

// Start game
app.post('/start-game', async (req, res) => {
    const { roomId } = req.body;
    console.log('Attempting to start game for room:', roomId);
    console.log('Available rooms:', Array.from(rooms.keys()));
    
    const room = rooms.get(roomId);
    console.log('Found room:', room);

    if (!room) {
        console.log('Room not found:', roomId);
        return res.status(404).json({ error: 'Room not found', roomId });
    }

    if (room.gameStarted) {
        console.log('Game already started in room:', roomId);
        return res.status(400).json({ error: 'Game already started' });
    }

    if (room.players.length < 2) {
        console.log('Not enough players in room:', roomId, 'Players:', room.players.length);
        return res.status(400).json({ error: 'Not enough players' });
    }

    const gameId = `game_${Date.now()}`;
        const game = {
            id: gameId,
        roomId,
        players: room.players,
        round: 1,
        submissions: new Map(),
        roundResults: []
    };

    games.set(gameId, game);
    room.gameStarted = true;
    room.gameId = gameId; // Store game ID in room

    try {
        console.log('Starting game:', gameId, 'in room:', roomId);
        // Notify all clients that the game has started
        await pusher.trigger(`game-channel-${roomId}`, 'game-start', {
            gameId,
            players: room.players
        });
        console.log('Game start event sent successfully');
        res.json({ gameId, players: room.players });
    } catch (err) {
        console.error('Pusher event error:', err);
        // Cleanup in case of error
        games.delete(gameId);
        room.gameStarted = false;
        room.gameId = null;
        res.status(500).json({ error: 'Failed to start game' });
    }
});

// Submit number endpoint
app.post('/submit-number', async (req, res) => {
    const { roomId, gameId, playerId, number } = req.body;
    console.log('Received number submission:', { roomId, gameId, playerId, number });

    // Validate input
    if (number < 0 || number > 100) {
        return res.status(400).json({ error: 'Invalid number. Must be between 0 and 100' });
    }

    // Get room and game
    const room = rooms.get(roomId);
        if (!room) {
        return res.status(404).json({ error: 'Room not found' });
        }

    const game = games.get(gameId);
        if (!game) {
        return res.status(404).json({ error: 'Game not found' });
        }

    // Check if player exists and is not eliminated
        const player = game.players.find(p => p.id === playerId);
        if (!player) {
        return res.status(404).json({ error: 'Player not found' });
    }

    // Check if player is eliminated
    if (player.points <= -10) {
        return res.status(400).json({ error: 'Player is eliminated' });
    }

    // Check if number was already submitted by this player
    if (game.submissions.has(playerId)) {
        return res.status(200).json({ 
            success: true,
            message: 'Number already submitted',
            alreadySubmitted: true
        });
    }

    // Store the submission
    game.submissions.set(playerId, number);
    console.log(`Player ${player.name} submitted number ${number}`);

    // Check if all active players have submitted
    const activePlayers = game.players.filter(p => p.points > -10);
    const allSubmitted = activePlayers.every(p => game.submissions.has(p.id));

    if (allSubmitted) {
        try {
            // Calculate and broadcast results
            await calculateRoundResults(game);
            res.json({ 
                success: true,
                allSubmitted: true,
                message: 'All players have submitted'
            });
        } catch (err) {
            console.error('Error calculating results:', err);
            res.status(500).json({ error: 'Failed to calculate results' });
        }
    } else {
        res.json({ 
            success: true,
            allSubmitted: false,
            message: 'Number submitted successfully'
        });
    }
});

async function calculateRoundResults(game) {
    const numbers = Array.from(game.submissions.values());
    const average = numbers.reduce((a, b) => a + b, 0) / numbers.length;
        const target = average * 0.8;

    const results = game.players.map(player => {
        const number = game.submissions.get(player.id);
                const distance = Math.abs(number - target);
                return {
            player, 
            number, 
            distance,
                    isWinner: false,
            points: 0,
            totalPoints: player.points
                };
            });

    // Sort by distance (closest first)
    results.sort((a, b) => a.distance - b.distance);

    // Find the winner (closest to target)
    const winner = results[0];
    winner.isWinner = true;
    winner.points = game.players.length - 1;
    winner.player.points += winner.points;
    winner.totalPoints = winner.player.points;
    
    // Update points and status for other players
    results.slice(1).forEach(result => {
        result.points = -1;
        result.player.points -= 1;
        result.totalPoints = result.player.points;
        result.isAlive = result.player.points > -10;
    });

    // Set winner's alive status
    winner.isAlive = winner.player.points > -10;

    game.roundResults.push({
        round: game.round,
        average,
        target,
        results
    });

    game.round++;
    game.submissions.clear();

    try {
        // Notify all clients of the round results
        await pusher.trigger(`game-channel-${game.roomId}`, 'round-result', {
            round: game.round - 1,
            average,
            target,
            results: results.map(r => ({
                playerId: r.player.id,
                playerName: r.player.name,
                number: r.number,
                distance: r.distance,
                points: r.points,
                totalPoints: r.totalPoints,
                isWinner: r.isWinner,
                isAlive: r.isAlive,
                isBot: r.player.isBot
            }))
        });
        console.log('Round results sent successfully');
    } catch (err) {
        console.error('Error sending round results:', err);
        throw err;
    }
}

// Test Pusher connection endpoint
app.get('/test-pusher', async (req, res) => {
    try {
        await pusher.trigger('my-channel', 'my-event', {
            message: 'Hello from the server!'
        });
        res.json({ message: 'Test event sent successfully' });
    } catch (err) {
        console.error('Pusher test error:', err);
        res.status(500).json({ error: 'Failed to send test event' });
    }
});

// Add chat message endpoint
app.post('/send-message', async (req, res) => {
    const { roomId, playerId, playerName, message } = req.body;
    
    console.log('Received chat message:', { roomId, playerId, playerName, message });
    
    const room = rooms.get(roomId);
    if (!room) {
        return res.status(404).json({ error: 'Room not found' });
    }

    if (!room.players.some(p => p.id === playerId)) {
        return res.status(403).json({ error: 'Player not in room' });
    }

    try {
        // Broadcast the message to all players in the room
        await pusher.trigger(`game-channel-${roomId}`, 'chat-message', {
            playerId,
            playerName,
            message,
            timestamp: new Date().toISOString()
        });
        
        console.log('Chat message sent successfully');
        res.json({ success: true });
    } catch (err) {
        console.error('Error sending chat message:', err);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// Leave spot endpoint
app.post('/leave', async (req, res) => {
        const { roomId, playerId, spotIndex } = req.body;
    console.log('Player leaving spot:', { roomId, playerId, spotIndex });

    const room = rooms.get(roomId);
    if (!room) {
        return res.status(404).json({ error: 'Room not found' });
    }

    // Check if game has already started
    if (room.gameStarted) {
        return res.status(400).json({ error: 'Cannot leave during an active game' });
    }

    // Find and remove the player
    const playerIndex = room.players.findIndex(p => p.id === playerId);
    if (playerIndex === -1) {
        return res.status(404).json({ error: 'Player not found' });
    }

    // Remove the player
    room.players.splice(playerIndex, 1);

    try {
        // Notify all clients in the room about the update
        await pusher.trigger(`game-channel-${roomId}`, 'waiting-room-update', {
            players: room.players
        });
        console.log('Player left successfully');
        res.json({ success: true });
    } catch (err) {
        console.error('Error sending update after player left:', err);
        // Add the player back since we couldn't notify others
        room.players.splice(playerIndex, 0, room.players[playerIndex]);
        res.status(500).json({ error: 'Failed to update room state' });
    }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
}); 