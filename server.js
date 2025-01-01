const express = require('express');
const path = require('path');
const Pusher = require('pusher');

const pusher = new Pusher({
    appId: "1919360",
    key: "e6a64e50330db39ab319",
    secret: "7e060c9a72e6db5311a6",
    cluster: "us2"
});

const app = express();

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Serve index.html for the root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

class GameServer {
    constructor() {
        this.games = new Map();
        this.waitingRoom = [];
    }

    handleJoin(playerName, spotIndex, isBot = false) {
        const playerId = Date.now().toString();
        console.log('Player joining:', { playerName, spotIndex, playerId, isBot });

        // Check if spot is already taken
        if (this.waitingRoom.some(p => p.spotIndex === spotIndex)) {
            throw new Error('Spot already taken');
        }

        // Remove any existing entries for this player name
        this.waitingRoom = this.waitingRoom.filter(p => p.name !== playerName);

        const player = {
            id: playerId,
            name: playerName,
            spotIndex: spotIndex,
            isBot: isBot
        };

        this.waitingRoom.push(player);
        console.log('Current waiting room:', this.waitingRoom);

        // Broadcast waiting room update
        pusher.trigger('game-channel', 'waiting-room-update', {
            players: this.waitingRoom,
            currentCount: this.waitingRoom.length,
            maxPlayers: 5
        });

        // If we have enough players, start a new game
        if (this.waitingRoom.length >= 5) {
            console.log('Starting new game with players:', this.waitingRoom);
            const gamePlayers = [...this.waitingRoom]; // Create a copy
            const gameId = this.startNewGame(gamePlayers);
            this.waitingRoom = []; // Clear waiting room after starting game
            return { playerId, gameId }; // Return both IDs
        }

        return { playerId }; // Return just the player ID if game hasn't started
    }

    handleLeave(playerId, spotIndex) {
        console.log('Player leaving:', { playerId, spotIndex });

        // Remove player from waiting room
        this.waitingRoom = this.waitingRoom.filter(p => p.id !== playerId);
        
        console.log('Updated waiting room:', this.waitingRoom);

        // Broadcast waiting room update
        pusher.trigger('game-channel', 'waiting-room-update', {
            players: this.waitingRoom,
            currentCount: this.waitingRoom.length,
            maxPlayers: 5
        });

        return { success: true };
    }

    startNewGame(players) {
        const gameId = Date.now().toString();
        console.log('Creating new game:', { gameId, playerCount: players.length });

        const game = {
            id: gameId,
            players: players.map(player => ({
                id: player.id,
                name: player.name,
                spotIndex: player.spotIndex,
                points: 0,
                isAlive: true,
                isBot: player.isBot
            })),
            currentRound: 1,
            numbers: {},
            state: 'active'
        };

        this.games.set(gameId, game);

        // Add a small delay before sending the game start event
        setTimeout(() => {
            console.log('Broadcasting game start:', {
                gameId: gameId,
                playerCount: players.length,
                players: game.players.map(p => ({ id: p.id, name: p.name, spotIndex: p.spotIndex, isBot: p.isBot }))
            });

            // Notify game start
            pusher.trigger('game-channel', 'game-start', {
                gameId: gameId,
                players: game.players
            });
        }, 1000); // 1 second delay

        return gameId;
    }

    handleNumberSubmit(gameId, playerId, number) {
        const game = this.games.get(gameId);
        if (!game) {
            console.error('Game not found:', gameId);
            throw new Error('Game not found');
        }

        // Validate player
        const player = game.players.find(p => p.id === playerId);
        if (!player) {
            console.error('Player not found in game:', { gameId, playerId });
            throw new Error('Player not found in game');
        }

        // Don't allow duplicate submissions
        if (game.numbers[playerId] !== undefined) {
            console.log('Player already submitted a number:', { playerId, number: game.numbers[playerId] });
            return { success: false, message: 'Number already submitted' };
        }

        console.log('Number submitted:', {
            gameId,
            playerId,
            number,
            currentRound: game.currentRound,
            isBot: player.isBot
        });

        // Store the submitted number
        if (!game.numbers) {
            game.numbers = {};
        }
        game.numbers[playerId] = number;

        // If this was a human player submitting, trigger bot submissions
        if (!player.isBot) {
            // Trigger bot submissions with a small delay
            setTimeout(() => {
                const botPlayers = game.players.filter(p => 
                    p.isBot && !game.numbers.hasOwnProperty(p.id)
                );
                
                if (botPlayers.length > 0) {
                    console.log('Triggering submissions for bots:', botPlayers.map(b => b.name));
                    this.submitBotNumbers(game);
                }
            }, 500);
        }

        // Check if all players submitted
        const allPlayersSubmitted = game.players.every(player => 
            game.numbers.hasOwnProperty(player.id)
        );

        if (allPlayersSubmitted) {
            // Add a small delay before calculating results
            setTimeout(() => this.calculateRoundResults(gameId), 500);
        }

        return { 
            success: true, 
            message: 'Number submitted successfully',
            allSubmitted: allPlayersSubmitted
        };
    }

    submitBotNumbers(game) {
        // Get all bot players who haven't submitted yet
        const botsToSubmit = game.players.filter(p => 
            p.isBot && !game.numbers.hasOwnProperty(p.id)
        );

        if (botsToSubmit.length === 0) return;

        console.log('Submitting numbers for bots:', botsToSubmit.map(b => b.name));

        // Submit numbers for each bot with a small delay between each
        botsToSubmit.forEach((bot, index) => {
            setTimeout(() => {
                if (!game.numbers[bot.id]) {  // Double check bot hasn't submitted
                    const botNumber = this.calculateBotNumber(game, bot);
                    game.numbers[bot.id] = botNumber;
                    console.log(`Bot ${bot.name} submitted number:`, botNumber);

                    // Broadcast the bot's submission
                    pusher.trigger('game-channel', 'bot-submit', {
                        gameId: game.id,
                        botName: bot.name,
                        number: botNumber
                    });

                    // Check if this was the last submission
                    const allSubmitted = game.players.every(p => game.numbers.hasOwnProperty(p.id));
                    if (allSubmitted) {
                        this.calculateRoundResults(game.id);
                    }
                }
            }, index * 1000); // 1 second delay between each bot
        });
    }

    calculateBotNumber(game, bot) {
        const alivePlayers = game.players.filter(p => p.isAlive).length;
        const previousNumbers = Object.values(game.numbers);
        const lastAverage = previousNumbers.length > 0 
            ? previousNumbers.reduce((a, b) => a + b, 0) / previousNumbers.length 
            : null;

        // Helper function to clamp number between 0 and 100
        const clamp = (num) => Math.min(100, Math.max(0, Math.floor(num)));

        // Different strategies based on number of players
        if (alivePlayers === 2) {
            return Math.random() < 0.7 ? 100 : clamp(Math.floor(Math.random() * 101));
        }

        if (alivePlayers === 3) {
            if (lastAverage) {
                const expectedAverage = lastAverage * 0.9;
                return clamp(Math.floor(expectedAverage * 0.8));
            }
            return clamp(Math.floor(Math.random() * 21) + 35);
        }

        if (alivePlayers <= 4) {
            const usedNumbers = Object.values(game.numbers);
            let botNumber;
            do {
                const ranges = [[35, 45], [45, 55], [55, 65]];
                const selectedRange = ranges[Math.floor(Math.random() * ranges.length)];
                botNumber = clamp(Math.floor(Math.random() * (selectedRange[1] - selectedRange[0])) + selectedRange[0]);
            } while (usedNumbers.includes(botNumber));
            return botNumber;
        }

        // Default strategy for 5 players
        if (lastAverage) {
            const expectedAverage = lastAverage * 0.95;
            const target = expectedAverage * 0.8;
            return clamp(Math.floor(target + (Math.random() * 10 - 5)));
        }

        return clamp(Math.floor(45 + (Math.random() * 15)));
    }

    calculateRoundResults(gameId) {
        const game = this.games.get(gameId);
        if (!game) return;

        const numbers = Object.values(game.numbers);
        const average = numbers.reduce((a, b) => a + b, 0) / numbers.length;
        const target = average * 0.8;

        // Calculate distances and prepare results
        const results = game.players.map(player => ({
            playerId: player.id,
            playerName: player.name,
            number: game.numbers[player.id],
            distance: Math.abs(game.numbers[player.id] - target)
        }));

        // Sort by distance
        results.sort((a, b) => a.distance - b.distance);

        // Check for exact match
        const hasExactMatch = results.some(r => r.distance === 0);

        // Send results to all players
        pusher.trigger('game-channel', 'round-result', {
            gameId: gameId,
            results: results,
            average: average,
            target: target,
            hasExactMatch: hasExactMatch
        });

        // Reset numbers for next round
        game.numbers = {};
        game.currentRound++;
    }

    // Add other game logic methods
}

const gameServer = new GameServer();

// API endpoints with error handling
app.post('/join', (req, res) => {
    try {
        const { playerName, spotIndex, isBot } = req.body;
        const result = gameServer.handleJoin(playerName, spotIndex, isBot);
        res.json(result);
    } catch (error) {
        console.error('Join error:', error);
        res.status(500).json({ error: 'Failed to join game' });
    }
});

app.post('/leave', (req, res) => {
    try {
        const { playerId, spotIndex } = req.body;
        const result = gameServer.handleLeave(playerId, spotIndex);
        res.json(result);
    } catch (error) {
        console.error('Leave error:', error);
        res.status(500).json({ error: 'Failed to leave game' });
    }
});

app.post('/submit-number', (req, res) => {
    try {
        const { gameId, playerId, number } = req.body;
        const result = gameServer.handleNumberSubmit(gameId, playerId, number);
        res.json(result);
    } catch (error) {
        console.error('Submit number error:', error);
        res.status(500).json({ error: 'Failed to submit number' });
    }
});

// Error handling middleware
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something broke!' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}); 