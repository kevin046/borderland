app.post('/submit-number', (req, res) => {
    const { roomId, gameId, playerId, number } = req.body;
    console.log('Received number submission:', { roomId, gameId, playerId, number });

    try {
        const room = rooms.get(roomId);
        if (!room) {
            return res.status(404).json({ success: false, message: 'Room not found' });
        }

        const game = room.games.get(gameId);
        if (!game) {
            return res.status(404).json({ success: false, message: 'Game not found' });
        }

        // Check if player is alive
        const player = room.players.find(p => p.id === playerId);
        if (!player || !player.isAlive) {
            return res.status(400).json({ success: false, message: 'Player is not alive or not found' });
        }

        // For bot submissions, generate a random number
        const isBot = player.isBot;
        const submittedNumber = isBot ? Math.floor(Math.random() * 101) : number;

        // Check if player has already submitted
        if (game.submissions.has(playerId)) {
            return res.json({ success: true, message: 'Number already submitted', alreadySubmitted: true });
        }

        // Add the submission
        game.submissions.set(playerId, submittedNumber);
        console.log(`Player ${playerId} submitted number ${submittedNumber}`);

        // Check if all alive players have submitted
        const alivePlayers = room.players.filter(p => p.isAlive);
        const allAliveSubmitted = alivePlayers.every(player => 
            game.submissions.has(player.id)
        );

        if (allAliveSubmitted) {
            console.log('All alive players have submitted. Calculating results...');
            calculateRoundResults(room, gameId);
        }

        return res.json({ 
            success: true, 
            message: 'Number submitted successfully',
            allSubmitted: allAliveSubmitted
        });
    } catch (error) {
        console.error('Error in submit-number:', error);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
}); 