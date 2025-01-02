const express = require('express');
const path = require('path');
const Pusher = require('pusher');
const cors = require('cors');

const app = express();

// CORS configuration
app.use(cors({
    origin: 'https://borderland-sigma.vercel.app',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
    optionsSuccessStatus: 200
}));

// Handle preflight requests
app.options('*', cors({
    origin: 'https://borderland-sigma.vercel.app',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
    optionsSuccessStatus: 200
}));

// Parse JSON bodies
app.use(express.json());

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

// Debugging middleware
app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    console.log('Headers:', req.headers);
    console.log('Body:', req.body);
    next();
});

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
    
    if (!rooms.has(roomId)) {
        return res.status(404).json({ error: 'Room not found' });
    }

    res.json({ roomId });
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
    const room = rooms.get(roomId);

    if (!room) {
        return res.status(404).json({ error: 'Room not found' });
    }

    if (room.players.length < 2) {
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

    try {
        // Notify all clients that the game has started
        await pusher.trigger(`game-channel-${roomId}`, 'game-start', {
            gameId,
            players: room.players
        });
        console.log('Game start event sent successfully');
        res.json({ gameId });
    } catch (err) {
        console.error('Pusher event error:', err);
        res.status(500).json({ error: 'Failed to start game' });
    }
});

// Submit number
app.post('/submit-number', async (req, res) => {
    const { roomId, gameId, playerId, number } = req.body;
    const game = games.get(gameId);

    if (!game) {
        return res.status(404).json({ error: 'Game not found' });
    }

    if (game.submissions.has(playerId)) {
        return res.json({ message: 'Number already submitted' });
    }

    game.submissions.set(playerId, number);

    // Check if all players have submitted
    if (game.submissions.size === game.players.length) {
        try {
            await calculateRoundResults(game);
            res.json({ success: true });
        } catch (err) {
            console.error('Error calculating results:', err);
            res.status(500).json({ error: 'Failed to calculate results' });
        }
    } else {
        res.json({ success: true });
    }
});

async function calculateRoundResults(game) {
    const numbers = Array.from(game.submissions.values());
    const average = numbers.reduce((a, b) => a + b, 0) / numbers.length;
    const target = average * 0.8;

    const results = game.players.map(player => {
        const number = game.submissions.get(player.id);
        const distance = Math.abs(number - target);
        return { player, number, distance };
    });

    // Sort by distance (closest first)
    results.sort((a, b) => a.distance - b.distance);

    // Update points
    results.forEach((result, index) => {
        const player = game.players.find(p => p.id === result.player.id);
        if (player) {
            player.points += (game.players.length - index);
        }
    });

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
                points: r.player.points
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

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
}); 