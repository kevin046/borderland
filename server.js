const express = require('express');
const path = require('path');
const Pusher = require('pusher');
const cors = require('cors');

const pusher = new Pusher({
    appId: "1919360",
    key: "e6a64e50330db39ab319",
    secret: "7e060c9a72e6db5311a6",
    cluster: "us2"
});

const app = express();

// CORS configuration
const corsOptions = {
    origin: [
        'http://localhost:3000',
        'https://borderland-sigma.vercel.app',
        'https://borderland-game.vercel.app'
    ],
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    optionsSuccessStatus: 200
};

// Apply CORS middleware
app.use(cors(corsOptions));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Serve index.html for the root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

class GameServer {
    constructor() {
        this.rooms = new Map(); // Map of roomId -> { games: Map, waitingRoom: [] }
    }

    createRoom(roomId) {
        if (this.rooms.has(roomId)) {
            throw new Error('Room already exists');
        }
        this.rooms.set(roomId, {
            games: new Map(),
            waitingRoom: []
        });
        return { success: true, roomId };
    }

    joinRoom(roomId) {
        const room = this.rooms.get(roomId);
        if (!room) {
            throw new Error('Room not found');
        }
        return { 
            success: true, 
            roomId,
            currentPlayers: room.waitingRoom.length,
            maxPlayers: 5
        };
    }

    handleJoin(roomId, playerName, spotIndex, isBot = false) {
        const room = this.rooms.get(roomId);
        if (!room) {
            throw new Error('Room not found');
        }

        const playerId = Date.now().toString();
        console.log('Player joining:', { roomId, playerName, spotIndex, playerId, isBot });

        // Check if spot is already taken
        if (room.waitingRoom.some(p => p.spotIndex === spotIndex)) {
            throw new Error('Spot already taken');
        }

        // Remove any existing entries for this player name
        room.waitingRoom = room.waitingRoom.filter(p => p.name !== playerName);

        const player = {
            id: playerId,
            name: playerName,
            spotIndex: spotIndex,
            isBot: isBot
        };

        room.waitingRoom.push(player);
        console.log('Current waiting room:', room.waitingRoom);

        // Broadcast waiting room update
        pusher.trigger(`game-channel-${roomId}`, 'waiting-room-update', {
            players: room.waitingRoom,
            currentCount: room.waitingRoom.length,
            maxPlayers: 5
        });

        // If we have enough players, start a new game
        if (room.waitingRoom.length >= 5) {
            console.log('Starting new game with players:', room.waitingRoom);
            const gamePlayers = [...room.waitingRoom]; // Create a copy
            const gameId = this.startNewGame(roomId, gamePlayers);
            room.waitingRoom = []; // Clear waiting room after starting game
            return { playerId, gameId, roomId }; // Return all IDs
        }

        return { playerId, roomId }; // Return both IDs
    }

    handleLeave(roomId, playerId, spotIndex) {
        const room = this.rooms.get(roomId);
        if (!room) {
            throw new Error('Room not found');
        }

        console.log('Player leaving:', { roomId, playerId, spotIndex });

        // Remove player from waiting room
        room.waitingRoom = room.waitingRoom.filter(p => p.id !== playerId);
        
        console.log('Updated waiting room:', room.waitingRoom);

        // Broadcast waiting room update
        pusher.trigger(`game-channel-${roomId}`, 'waiting-room-update', {
            players: room.waitingRoom,
            currentCount: room.waitingRoom.length,
            maxPlayers: 5
        });

        // If room is empty, delete it
        if (room.waitingRoom.length === 0 && room.games.size === 0) {
            this.rooms.delete(roomId);
            console.log('Deleted empty room:', roomId);
        }

        return { success: true };
    }

    startNewGame(roomId, players) {
        const room = this.rooms.get(roomId);
        if (!room) {
            throw new Error('Room not found');
        }

        const gameId = Date.now().toString();
        console.log('Creating new game:', { roomId, gameId, playerCount: players.length });

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

        room.games.set(gameId, game);

        // Add a small delay before sending the game start event
        setTimeout(() => {
            console.log('Broadcasting game start:', {
                roomId,
                gameId: gameId,
                playerCount: players.length,
                players: game.players.map(p => ({ id: p.id, name: p.name, spotIndex: p.spotIndex, isBot: p.isBot }))
            });

            // Notify game start
            pusher.trigger(`game-channel-${roomId}`, 'game-start', {
                gameId: gameId,
                players: game.players
            });
        }, 1000); // 1 second delay

        return gameId;
    }

    handleNumberSubmit(roomId, gameId, playerId, number) {
        const room = this.rooms.get(roomId);
        if (!room) {
            throw new Error('Room not found');
        }

        const game = room.games.get(gameId);
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

        // Check if player is dead
        if (!player.isAlive) {
            console.error('Dead player tried to submit:', { gameId, playerId });
            return { success: false, message: 'Dead players cannot submit numbers' };
        }

        // Don't allow duplicate submissions from same player
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

        // If this was a human player submitting, trigger bot submissions for alive bots only
        if (!player.isBot) {
            const aliveBotPlayers = game.players.filter(p => 
                p.isBot && p.isAlive && !game.numbers.hasOwnProperty(p.id)
            );
            
            if (aliveBotPlayers.length > 0) {
                console.log('Triggering immediate bot submissions for:', aliveBotPlayers.map(b => b.name));
                this.submitBotNumbers(game);
            }
        }

        // Check if all alive players have submitted
        const alivePlayersSubmitted = game.players
            .filter(p => p.isAlive)
            .every(p => game.numbers.hasOwnProperty(p.id));
        
        if (alivePlayersSubmitted) {
            console.log('All alive players have submitted. Calculating results...');
            // Calculate results after a short delay
            setTimeout(() => {
                this.calculateRoundResults(gameId);
            }, 1000);
        } else {
            console.log('Waiting for more submissions:', {
                submitted: Object.keys(game.numbers).length,
                total: game.players.filter(p => p.isAlive).length,
                missing: game.players.filter(p => p.isAlive && !game.numbers.hasOwnProperty(p.id)).map(p => p.name)
            });
        }

        return { success: true, message: 'Number submitted successfully' };
    }

    submitBotNumbers(game) {
        // Get all bot players who haven't submitted yet
        const botsToSubmit = game.players.filter(p => 
            p.isBot && !game.numbers.hasOwnProperty(p.id)
        );

        if (botsToSubmit.length === 0) {
            console.log('No bots need to submit numbers');
            return;
        }

        console.log('Processing bot submissions for:', botsToSubmit.map(b => b.name));

        // Submit numbers for each bot immediately
        botsToSubmit.forEach(bot => {
            const botNumber = this.calculateBotNumber(game, bot);
            game.numbers[bot.id] = botNumber;
            console.log(`Bot ${bot.name} submitted number:`, botNumber);

            // Notify clients about bot submission
            pusher.trigger('game-channel', 'bot-submit', {
                gameId: game.id,
                botName: bot.name,
                number: botNumber
            });
        });

        // Check if all players have submitted after bot submissions
        const allSubmitted = game.players.every(p => game.numbers.hasOwnProperty(p.id));
        if (allSubmitted) {
            console.log('All players (including bots) have submitted. Calculating results...');
            setTimeout(() => {
                this.calculateRoundResults(game.id);
            }, 1000);
        } else {
            console.log('Still waiting for submissions after bot moves:', {
                submitted: Object.keys(game.numbers).length,
                total: game.players.length,
                missing: game.players.filter(p => !game.numbers.hasOwnProperty(p.id)).map(p => p.name)
            });
        }
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
        if (!game) {
            console.error('Game not found for results calculation:', gameId);
            return;
        }

        // Only get alive players' submissions
        const alivePlayersSubmitted = game.players
            .filter(p => p.isAlive)
            .every(p => game.numbers.hasOwnProperty(p.id));

        if (!alivePlayersSubmitted) {
            console.error('Not all alive players have submitted numbers');
            return;
        }

        console.log('Calculating round results for game:', gameId);
        console.log('Submitted numbers:', game.numbers);

        // Calculate average and target only from alive players' numbers
        const alivePlayerNumbers = game.players
            .filter(p => p.isAlive)
            .map(p => Number(game.numbers[p.id]));

        const average = alivePlayerNumbers.reduce((a, b) => a + b, 0) / alivePlayerNumbers.length;
        const target = average * 0.8;

        console.log('Numbers:', alivePlayerNumbers);
        console.log('Average:', average);
        console.log('Target:', target);

        // Count alive players
        const alivePlayers = game.players.filter(p => p.isAlive).length;
        console.log('Alive players:', alivePlayers);

        // Check for duplicate numbers (only when 4 or fewer players are alive)
        const numberCounts = {};
        let hasDuplicates = false;
        if (alivePlayers <= 4) {
            alivePlayerNumbers.forEach(number => {
                numberCounts[number] = (numberCounts[number] || 0) + 1;
            });
            hasDuplicates = Object.values(numberCounts).some(count => count > 1);
            console.log('Number counts:', numberCounts);
            console.log('Has duplicates:', hasDuplicates);
        }

        // Calculate distances and prepare results only for alive players
        const results = game.players
            .filter(p => p.isAlive)
            .map(player => {
                const number = game.numbers[player.id];
                // Only mark as invalid if we have 4 or fewer players AND the number is a duplicate
                const isDuplicate = alivePlayers <= 4 && numberCounts[number] > 1;
                const distance = Math.abs(number - target);

                return {
                    playerId: player.id,
                    playerName: player.name,
                    number: number,
                    distance: distance,
                    isBot: player.isBot,
                    invalid: isDuplicate,
                    isWinner: false,
                    points: player.points,
                    isAlive: player.isAlive
                };
            });

        // Special rule for 2 players: 0 and 100
        if (alivePlayers === 2) {
            const hasZero = alivePlayerNumbers.includes(0);
            const has100 = alivePlayerNumbers.includes(100);
            if (hasZero && has100) {
                results.forEach(r => {
                    if (r.number === 100) {
                        r.isWinner = true;
                        console.log(`${r.playerName} wins with special rule (100)`);
                    }
                });
            }
        }

        // If no winner set by special rules, determine winner by closest to target
        if (!results.some(r => r.isWinner)) {
            // Get valid results (non-duplicate numbers if 4 or fewer players)
            const validResults = alivePlayers <= 4 ? results.filter(r => !r.invalid) : results;
            if (validResults.length > 0) {
                const minDistance = Math.min(...validResults.map(r => r.distance));
                
                // Mark ALL players with minimum distance as winners in the main results array
                results.forEach(result => {
                    if (!result.invalid && Math.abs(result.distance - minDistance) < 0.0001) {
                        result.isWinner = true;
                        console.log(`${result.playerName} wins with number ${result.number} (distance: ${result.distance.toFixed(2)})`);
                    }
                });
            }
        }

        // Check for exact match when 3 players remain
        const hasExactMatch = alivePlayers === 3 && results.some(r => Math.abs(r.distance) < 0.0001);

        // Log all winners for debugging
        const winners = results.filter(r => r.isWinner);
        console.log('Winners this round:', winners.map(w => ({
            name: w.playerName,
            number: w.number,
            distance: w.distance,
            points: w.points
        })));

        // Update points - ONLY for non-winners
        results.forEach(result => {
            const player = game.players.find(p => p.id === result.playerId);
            if (!player) return;

            const oldPoints = player.points;
            
            // Skip point deduction for winners
            if (result.isWinner) {
                console.log(`${player.name} is a winner - keeping points at ${oldPoints}`);
                result.points = oldPoints; // Ensure winner's points stay the same
            } else {
                // Calculate point loss for non-winners only
                let pointLoss = 1; // Default point loss

                if (result.invalid && alivePlayers <= 4) {
                    pointLoss = 1;
                    console.log(`${player.name} loses ${pointLoss} point (duplicate number)`);
                } else if (hasExactMatch && alivePlayers === 3) {
                    pointLoss = 2;
                    console.log(`${player.name} loses ${pointLoss} points (exact match penalty)`);
                } else {
                    pointLoss = 1;
                    console.log(`${player.name} loses ${pointLoss} point (standard loss)`);
                }

                player.points -= pointLoss;
                result.points = player.points;
                console.log(`${player.name} points updated from ${oldPoints} to ${player.points}`);
            }

            // Check for elimination
            if (player.points <= -10) {
                player.isAlive = false;
                result.isAlive = false;
                console.log(`${player.name} has been eliminated!`);
            }
        });

        console.log('Round results calculated:', {
            average,
            target,
            results: results.map(r => ({
                player: r.playerName,
                number: r.number,
                distance: r.distance,
                invalid: r.invalid,
                isWinner: r.isWinner,
                points: r.points,
                isAlive: game.players.find(p => p.id === r.playerId)?.isAlive
            }))
        });

        // Send results to all players
        pusher.trigger('game-channel', 'round-result', {
            gameId: gameId,
            results: results,
            average: average,
            target: target,
            hasExactMatch: hasExactMatch,
            alivePlayers: alivePlayers
        });

        // Reset numbers for next round
        game.numbers = {};
        game.currentRound++;
    }

    // Add other game logic methods
}

const gameServer = new GameServer();

// API endpoints with error handling
app.post('/create-room', (req, res) => {
    try {
        const { roomId } = req.body;
        const result = gameServer.createRoom(roomId);
        res.json(result);
    } catch (error) {
        console.error('Create room error:', error);
        res.status(400).json({ error: error.message });
    }
});

app.post('/join-room', (req, res) => {
    try {
        const { roomId } = req.body;
        const result = gameServer.joinRoom(roomId);
        res.json(result);
    } catch (error) {
        console.error('Join room error:', error);
        res.status(400).json({ error: error.message });
    }
});

app.post('/join', (req, res) => {
    try {
        const { roomId, playerName, spotIndex, isBot } = req.body;
        const result = gameServer.handleJoin(roomId, playerName, spotIndex, isBot);
        res.json(result);
    } catch (error) {
        console.error('Join error:', error);
        res.status(400).json({ error: error.message });
    }
});

app.post('/leave', (req, res) => {
    try {
        const { roomId, playerId, spotIndex } = req.body;
        const result = gameServer.handleLeave(roomId, playerId, spotIndex);
        res.json(result);
    } catch (error) {
        console.error('Leave error:', error);
        res.status(400).json({ error: error.message });
    }
});

app.post('/submit-number', (req, res) => {
    try {
        const { roomId, gameId, playerId, number } = req.body;
        const result = gameServer.handleNumberSubmit(roomId, gameId, playerId, number);
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