const Pusher = require('pusher');

const pusher = new Pusher({
    appId: "1919360",
    key: "e6a64e50330db39ab319",
    secret: "7e060c9a72e6db5311a6",
    cluster: "us2"
});

class GameServer {
    constructor() {
        this.games = new Map();
        this.waitingRoom = [];
    }

    handleJoin(playerName, spotIndex) {
        const playerId = Date.now().toString();

        const player = {
            id: playerId,
            name: playerName,
            spotIndex: spotIndex
        };

        this.waitingRoom.push(player);

        // Broadcast waiting room update
        pusher.trigger('game-channel', 'waiting-room-update', {
            players: this.waitingRoom
        });

        // If we have enough players, start a new game
        if (this.waitingRoom.length >= 5) {
            const gamePlayers = this.waitingRoom.splice(0, 5);
            this.startNewGame(gamePlayers);
        }

        return playerId;
    }

    startNewGame(players) {
        const gameId = Date.now().toString();
        const game = {
            id: gameId,
            players: players,
            currentRound: 1,
            numbers: {},
            state: 'waiting'
        };

        this.games.set(gameId, game);

        // Notify game start
        pusher.trigger('game-channel', 'game-start', {
            gameId: gameId,
            players: players
        });
    }

    handleNumberSubmit(gameId, playerId, number) {
        const game = this.games.get(gameId);
        if (!game) return;

        game.numbers[playerId] = number;

        // Check if all players submitted
        if (Object.keys(game.numbers).length === game.players.length) {
            this.calculateRoundResults(gameId);
        }
    }

    // Add other game logic methods
}

// Create Express server to handle HTTP requests
const express = require('express');
const app = express();
app.use(express.json());

const gameServer = new GameServer();

// Endpoints
app.post('/join', (req, res) => {
    const { playerName, spotIndex } = req.body;
    const playerId = gameServer.handleJoin(playerName, spotIndex);
    res.json({ playerId });
});

app.post('/submit-number', (req, res) => {
    const { gameId, playerId, number } = req.body;
    gameServer.handleNumberSubmit(gameId, playerId, number);
    res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}); 