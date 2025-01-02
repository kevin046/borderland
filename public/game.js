class DeathGame {
    constructor() {
        this.pusher = new Pusher('e6a64e50330db39ab319', {
            cluster: 'us2'
        });
        this.setupPusher();
        this.players = [];
        this.maxPlayers = 5;
        this.currentRound = 1;
        this.timeLimit = 30;
        this.remainingTime = this.timeLimit;
        this.timer = null;
        this.playerNumbers = {}; // Store submitted numbers
        this.roundHistory = []; // Store history of all rounds
        this.selectedSpot = null;
        this.currentPlayer = null; // Store current player's spot
        this.gameStarted = false; // Add flag to track if game has started
        this.roomId = null; // Store current room ID
        
        // Set server URL based on environment
        this.serverUrl = window.location.hostname === 'localhost' 
            ? 'http://localhost:3000' 
            : 'https://borderland-game-server.onrender.com';
            
        this.setupAudio();
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        // Room selection buttons
        document.getElementById('create-room').addEventListener('click', () => this.createRoom());
        document.getElementById('join-room').addEventListener('click', () => this.joinRoom());

        // Get the submit button element
        const submitButton = document.getElementById('submit-number');
        if (submitButton) {
            submitButton.addEventListener('click', () => this.submitNumber());
        }

        // Get the start game button element
        const startButton = document.getElementById('start-game');
        if (startButton) {
            startButton.addEventListener('click', () => {
                // Disable the button immediately to prevent double clicks
                startButton.disabled = true;
                startButton.textContent = 'Waiting for game to start...';
            });
        }

        const joinButtons = document.querySelectorAll('.join-btn');
        joinButtons.forEach((btn, index) => {
            btn.addEventListener('click', () => this.showNameModal(index));
        });

        const botButtons = document.querySelectorAll('.bot-btn');
        botButtons.forEach((btn, index) => {
            btn.addEventListener('click', () => this.addBot(index));
        });

        // Name modal buttons
        document.getElementById('confirm-name').addEventListener('click', () => this.confirmJoin());
        document.getElementById('cancel-join').addEventListener('click', () => this.hideNameModal());
    }

    createRoom() {
        const roomInput = document.getElementById('room-number');
        const roomId = roomInput.value.trim();
        
        if (!roomId || roomId < 1 || roomId > 9999) {
            alert('Please enter a valid room number (1-9999)');
            return;
        }

        console.log('Attempting to create room:', roomId);
        console.log('Server URL:', this.serverUrl);

        fetch(`${this.serverUrl}/create-room`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            mode: 'cors',
            body: JSON.stringify({ roomId })
        })
        .then(response => {
            console.log('Server response:', response);
            if (!response.ok) {
                return response.text().then(text => {
                    throw new Error(`HTTP error! status: ${response.status}, body: ${text}`);
                });
            }
            return response.json();
        })
        .then(data => {
            console.log('Room created successfully:', data);
            this.roomId = data.roomId;
            this.subscribeToRoom(this.roomId);
            document.getElementById('room-screen').classList.remove('active');
            document.getElementById('login-screen').classList.add('active');
        })
        .catch(error => {
            console.error('Detailed error creating room:', error);
            console.error('Error stack:', error.stack);
            alert('Failed to create room. Please check the console for details.');
        });
    }

    joinRoom() {
        const roomInput = document.getElementById('room-number');
        const roomId = roomInput.value.trim();
        
        if (!roomId || roomId < 1 || roomId > 9999) {
            alert('Please enter a valid room number (1-9999)');
            return;
        }

        fetch(`${this.serverUrl}/join-room`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            mode: 'cors',
            body: JSON.stringify({ roomId })
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            console.log('Room joined:', data);
            this.roomId = data.roomId;
            this.subscribeToRoom(this.roomId);
            document.getElementById('room-screen').classList.remove('active');
            document.getElementById('login-screen').classList.add('active');
        })
        .catch(error => {
            console.error('Error joining room:', error);
            alert('Failed to join room. Room might not exist.');
        });
    }

    subscribeToRoom(roomId) {
        // Unsubscribe from any existing channel
        if (this.gameChannel) {
            this.pusher.unsubscribe(this.gameChannel.name);
        }
        
        // Subscribe to the room-specific channel
        this.gameChannel = this.pusher.subscribe(`game-channel-${roomId}`);
        this.setupPusher();
    }

    setupPusher() {
        if (!this.gameChannel) return;

        this.gameChannel.bind('waiting-room-update', data => {
            console.log('Waiting room update:', data);
            this.updateWaitingRoom(data.players);
        });

        this.gameChannel.bind('game-start', data => {
            console.log('Game start event received:', data);
            this.handleGameStart(data);
        });

        this.gameChannel.bind('round-result', data => {
            console.log('Round result received from server:', data);
            
            // Clear any pending bot submission messages
            const botMessages = document.querySelector('.bot-messages');
            if (botMessages) {
                botMessages.innerHTML = '';
            }

            // Disable all number buttons and submit button
            const numberBtns = document.querySelectorAll('.number-btn');
            const submitBtn = document.getElementById('submit-number');
            numberBtns.forEach(btn => {
                btn.disabled = true;
                btn.classList.remove('selected');
            });
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.classList.remove('ready');
            }

            // Update status message
            const statusMessage = document.querySelector('.status-message');
            if (statusMessage) {
                statusMessage.textContent = 'Round complete! Calculating results...';
            }

            // Update average and target immediately
            const averageDisplay = document.querySelector('.average');
            const targetDisplay = document.querySelector('.target');
            
            if (averageDisplay) {
                averageDisplay.textContent = data.average.toFixed(2);
            }
            
            if (targetDisplay) {
                targetDisplay.textContent = data.target.toFixed(2);
            }

            // Clear and update the numbers list
            const numbersList = document.querySelector('.numbers-list');
            if (numbersList) {
                numbersList.innerHTML = '';
                
                // Sort results by distance
                const sortedResults = [...data.results].sort((a, b) => a.distance - b.distance);
                
                sortedResults.forEach(result => {
                    const submissionEntry = document.createElement('div');
                    submissionEntry.className = `submission-entry ${result.isWinner ? 'winner' : ''} ${!result.isAlive ? 'eliminated' : ''} ${result.invalid ? 'invalid' : ''}`;
                    
                    submissionEntry.innerHTML = `
                        <div class="player-info">
                            <span class="player-icon">${result.isBot ? '🤖' : '👤'}</span>
                            <span class="player-name">${result.player}</span>
                        </div>
                        <div class="submission-details">
                            <span class="number-submitted">Number: ${result.number}</span>
                            <span class="distance">Distance: ${result.distance.toFixed(2)}</span>
                            <span class="points ${result.points < 0 ? 'negative' : ''}">Points: ${result.points > 0 ? '+' : ''}${result.points}</span>
                        </div>
                        <div class="status-badges">
                            ${result.isWinner ? '<span class="winner-badge">👑 Winner</span>' : ''}
                            ${result.invalid ? '<span class="invalid-badge">❌ Invalid</span>' : ''}
                            ${!result.isAlive ? '<span class="eliminated-badge">💀 Eliminated</span>' : ''}
                        </div>
                    `;
                    
                    numbersList.appendChild(submissionEntry);

                    // Update player card
                    const playerCard = document.querySelector(`.player-card[data-player-id="${result.playerId}"]`);
                    if (playerCard) {
                        const pointsValue = playerCard.querySelector('.points-value');
                        const statusDiv = playerCard.querySelector('.player-status');

                        if (pointsValue) {
                            pointsValue.textContent = result.totalPoints;
                            pointsValue.className = `points-value ${result.totalPoints < 0 ? 'negative' : ''}`;
                        }

                        if (statusDiv) {
                            if (!result.isAlive) {
                                statusDiv.textContent = 'Eliminated';
                                statusDiv.className = 'player-status eliminated';
                                playerCard.classList.add('eliminated');
                            } else if (result.isWinner) {
                                statusDiv.textContent = 'Winner!';
                                statusDiv.className = 'player-status winner';
                            } else {
                                statusDiv.textContent = 'Ready';
                                statusDiv.className = 'player-status';
                            }
                        }
                    }
                });
            }

            // Play appropriate sound effects
            if (data.results.some(r => !r.isAlive)) {
                this.playSound('elimination');
            } else if (data.results.some(r => r.isWinner)) {
                this.playSound('winner');
            }

            // Start 10-second cooldown
            let countdown = 10;
            if (statusMessage) {
                statusMessage.textContent = `Next round starting in ${countdown} seconds...`;
            }

            const countdownInterval = setInterval(() => {
                countdown--;
                if (statusMessage) {
                    statusMessage.textContent = `Next round starting in ${countdown} seconds...`;
                }
                
                if (countdown <= 0) {
                    clearInterval(countdownInterval);
                    const currentPlayerResult = data.results.find(r => r.playerId === this.playerId);
                    if (currentPlayerResult && currentPlayerResult.isAlive) {
                        // Increment round number
                        this.currentRound++;
                        const roundNumber = document.querySelector('.round-number');
                        if (roundNumber) {
                            roundNumber.textContent = this.currentRound;
                        }

                        // Re-enable buttons for next round
                        numberBtns.forEach(btn => {
                            btn.disabled = false;
                            btn.classList.remove('disabled');
                        });

                        // Update status message
                        if (statusMessage) {
                            statusMessage.textContent = 'Choose your number for the next round...';
                        }

                        // Start new round timer
                        this.startRoundTimer();
                    }
                }
            }, 1000);
        });

        this.gameChannel.bind('bot-submit', data => {
            console.log('Bot submission received:', data);
            const botMessages = document.querySelector('.bot-messages');
            if (botMessages) {
                const botMessage = document.createElement('div');
                botMessage.className = 'bot-message';
                botMessage.textContent = `${data.botName} submitted their number...`;
                botMessages.appendChild(botMessage);
            }
        });
    }

    // Update other methods to include roomId in requests
    confirmJoin() {
        const nameInput = document.getElementById('player-name-input');
        const name = nameInput.value.trim();
        
        if (!name) {
            alert('Please enter a name');
            return;
        }

        if (this.selectedSpot === null) {
            alert('Please select a spot');
            return;
        }

        if (!this.roomId) {
            alert('No room selected');
            return;
        }

        console.log('Attempting to join room:', {
            roomId: this.roomId,
            playerName: name,
            spotIndex: this.selectedSpot
        });

        fetch(`${this.serverUrl}/join`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            mode: 'cors',
            body: JSON.stringify({
                roomId: this.roomId,
                playerName: name,
                spotIndex: this.selectedSpot
            })
        })
        .then(response => {
            console.log('Join response:', response);
            if (!response.ok) {
                return response.text().then(text => {
                    throw new Error(`HTTP error! status: ${response.status}, body: ${text}`);
                });
            }
            return response.json();
        })
        .then(data => {
            console.log('Join successful:', data);
            this.playerId = data.playerId;
            if (data.gameId) {
                this.gameId = data.gameId;
            }
            this.addPlayer(this.selectedSpot, name);
            this.hideNameModal();
        })
        .catch(error => {
            console.error('Detailed error joining game:', error);
            console.error('Error stack:', error.stack);
            alert('Failed to join game. Please check the console for details.');
        });
    }

    addBot(index) {
        if (!this.roomId) {
            console.error('No room ID found');
            return;
        }

        if (this.players.some(p => p.index === index)) {
            alert('This spot is already taken!');
            return;
        }

        this.playSound('buttonClick');
        const botName = `Bot ${index + 1}`;
        
        console.log('Adding bot:', {
            roomId: this.roomId,
            playerName: botName,
            spotIndex: index,
            isBot: true
        });

        fetch(`${this.serverUrl}/join`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            mode: 'cors',
            body: JSON.stringify({
                roomId: this.roomId,
                playerName: botName,
                spotIndex: Number(index), // Ensure index is a number
                isBot: true
            })
        })
        .then(response => {
            console.log('Bot join response:', response);
            if (!response.ok) {
                return response.text().then(text => {
                    throw new Error(`HTTP error! status: ${response.status}, body: ${text}`);
                });
            }
            return response.json();
        })
        .then(data => {
            console.log('Bot join successful:', data);
            // Bot joining is handled through waiting room update
        })
        .catch(error => {
            console.error('Detailed error adding bot:', error);
            console.error('Error stack:', error.stack);
            alert('Failed to add bot. Please check the console for details.');
        });
    }

    submitNumber() {
        if (typeof this.selectedNumber === 'undefined') {
            alert('Please select a number');
            return;
        }

        const submitButton = document.getElementById('submit-number');
        const numberBtns = document.querySelectorAll('.number-btn');
        
        if (submitButton) {
            submitButton.disabled = true;
        }

        // Disable all number buttons
        numberBtns.forEach(btn => btn.disabled = true);

        // First submit the human player's number
        this.submitNumberToServer(this.roomId, this.gameId, this.playerId, this.selectedNumber)
            .then(data => {
                console.log('Human number submission response:', data);
                
                // Update status message
                const statusMessage = document.querySelector('.status-message');
                if (statusMessage) {
                    statusMessage.textContent = `Your number ${this.selectedNumber} has been submitted. Waiting for other players...`;
                }

                // If all players have already submitted, we don't need to submit bot numbers
                if (data.allSubmitted) {
                    console.log('All players have already submitted');
                    return null;
                }

                // After successful human submission, submit bot numbers
                const botPlayers = this.players.filter(p => p.isBot);
                if (botPlayers.length > 0) {
                    console.log('Submitting bot numbers:', botPlayers);
                    
                    // Submit all bot numbers simultaneously
                    const botPromises = botPlayers.map(bot => 
                        this.submitNumberToServer(this.roomId, this.gameId, bot.id, -1)
                            .then(botData => {
                                console.log(`Bot ${bot.name} submission response:`, botData);
                                if (botData.alreadySubmitted) {
                                    console.log(`Bot ${bot.name} had already submitted`);
                                }
                                return botData;
                            })
                    );

                    return Promise.all(botPromises).then(results => {
                        // Check if any submission indicates all players have submitted
                        const allSubmitted = results.some(result => result && result.allSubmitted);
                        if (allSubmitted) {
                            console.log('All players have submitted their numbers');
                            // Update status message
                            if (statusMessage) {
                                statusMessage.textContent = 'All numbers submitted. Waiting for round results...';
                            }
                        }
                        return results;
                    });
                }
                return null;
            })
            .then(() => {
                this.selectedNumber = undefined;
                this.playSound('submit');
            })
            .catch(error => {
                console.error('Error in number submission:', error);
                
                // Re-enable buttons on error
                if (submitButton) {
                    submitButton.disabled = false;
                }
                numberBtns.forEach(btn => btn.disabled = false);
                
                // Update status message
                const statusMessage = document.querySelector('.status-message');
                if (statusMessage) {
                    statusMessage.textContent = 'Failed to submit number. Please try again.';
                }
                
                alert('Failed to submit number. Please try again.');
            });
    }

    // Helper method to submit numbers to the server
    submitNumberToServer(roomId, gameId, playerId, number) {
        console.log('Submitting to server:', { roomId, gameId, playerId, number });
        return fetch(`${this.serverUrl}/submit-number`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            mode: 'cors',
            body: JSON.stringify({
                roomId: roomId,
                gameId: gameId,
                playerId: playerId,
                number: number
            })
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            console.log('Server response:', data);
            // Always treat "already submitted" as a success case
            if (data.message === 'Number already submitted') {
                return { 
                    success: true, 
                    message: 'Number already submitted',
                    alreadySubmitted: true 
                };
            }
            return data;
        })
        .catch(error => {
            console.error('Error in submitNumberToServer:', error);
            throw error;
        });
    }

    leaveGame() {
        if (this.gameStarted) {
            alert('Cannot leave during an active game!');
            return;
        }

        if (this.currentPlayer === null || !this.roomId) {
            return;
        }

        fetch(`${this.serverUrl}/leave`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            mode: 'cors',
            body: JSON.stringify({
                roomId: this.roomId,
                playerId: this.playerId,
                spotIndex: this.currentPlayer
            })
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            console.log('Leave game response:', data);
            this.removePlayerFromSpot(this.currentPlayer);
            this.playerId = null;
        })
        .catch(error => {
            console.error('Error leaving game:', error);
            alert('Failed to leave game. Please try again.');
        });
    }

    resetGame() {
        // Stop all sounds
        this.sounds.bgMusic.pause();
        this.sounds.bgMusic.currentTime = 0;
        
        // Reset all game state
        this.players = [];
        this.currentRound = 1;
        this.playerNumbers = {};
        this.selectedNumber = undefined;
        this.roomId = null; // Reset room ID
        clearInterval(this.timer);

        // Unsubscribe from current game channel
        if (this.gameChannel) {
            this.pusher.unsubscribe(this.gameChannel.name);
            this.gameChannel = null;
        }

        // Reset UI back to room selection
        document.getElementById('game-screen').classList.remove('active');
        document.getElementById('login-screen').classList.remove('active');
        document.getElementById('room-screen').classList.add('active');
        
        // Clear room number input
        const roomInput = document.getElementById('room-number');
        if (roomInput) {
            roomInput.value = '';
        }

        // Reset other UI elements
        document.querySelector('.game-info').innerHTML = `
            <h2>Round <span id="round-number">1</span></h2>
            <div id="timer">Time remaining: <span id="time">60</span>s</div>
            <div id="current-rules"></div>
        `;
        document.querySelector('.players-grid').innerHTML = '';
        document.querySelector('.number-input').innerHTML = '';

        // Clear results and countdowns
        const resultsElements = document.querySelectorAll('.round-results, .results-countdown, .winner-announcement');
        resultsElements.forEach(el => el.remove());
        
        // Reset player slots
        const nameInputs = document.querySelectorAll('.player-name');
        const readyBtns = document.querySelectorAll('.ready-btn');
        const botBtns = document.querySelectorAll('.bot-btn');
        
        nameInputs.forEach(input => {
            input.value = '';
            input.disabled = false;
        });
        
        readyBtns.forEach(btn => btn.classList.remove('active'));
        botBtns.forEach(btn => btn.style.display = 'block');
        
        // Reset players counter
        document.getElementById('players-ready').textContent = '0';
        document.getElementById('start-game').disabled = true;

        // Reset audio controls
        const toggleMusic = document.getElementById('toggleMusic');
        if (toggleMusic) {
            toggleMusic.textContent = '🔈';
        }

        // Reset remaining time
        this.remainingTime = this.timeLimit;

        this.roundHistory = [];
        this.gameStarted = false;
        this.currentPlayer = null;
    }

    setupAudio() {
        this.sounds = {
            bgMusic: document.getElementById('bgMusic'),
            buttonClick: document.getElementById('buttonClick'),
            submit: document.getElementById('submitSound'),
            winner: document.getElementById('winnerSound'),
            elimination: document.getElementById('eliminationSound')
        };

        // Set volumes
        this.sounds.bgMusic.volume = 0.3;
        this.sounds.buttonClick.volume = 0.5;
        this.sounds.submit.volume = 0.6;
        this.sounds.winner.volume = 0.7;
        this.sounds.elimination.volume = 0.6;

        // Preload audio files
        Object.values(this.sounds).forEach(sound => {
            sound.load();
        });

        // Add error handling for audio loading
        this.sounds.bgMusic.addEventListener('error', () => {
            console.error('Error loading background music');
        });
    }

    playSound(soundId) {
        const sound = this.sounds[soundId];
        if (sound) {
            sound.currentTime = 0;
            const playPromise = sound.play();
            
            if (playPromise !== undefined) {
                playPromise.catch(error => {
                    console.error(`Error playing ${soundId}:`, error);
                });
            }
        }
    }

    showNameModal(spotIndex) {
        // Don't allow changing spots after game starts
        if (this.gameStarted) {
            return;
        }

        // Check if spot is already taken
        if (this.players.some(p => p.index === spotIndex)) {
            alert('This spot is already taken!');
            return;
        }

        // If user already has a spot, they can only change their own spot
        if (this.currentPlayer !== null) {
            // Only allow changing their own spot
            const currentPlayerData = this.players.find(p => p.index === this.currentPlayer);
            if (currentPlayerData) {
                // First, leave the current spot
                fetch(`${this.serverUrl}/leave`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        roomId: this.roomId,
                        playerId: this.playerId,
                        spotIndex: this.currentPlayer
                    })
                })
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    return response.json();
                })
                .then(() => {
                    // Then, join the new spot with the same name
                    return fetch(`${this.serverUrl}/join`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            roomId: this.roomId,
                            playerName: currentPlayerData.name,
                            spotIndex: spotIndex
                        })
                    });
                })
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    return response.json();
                })
                .then(data => {
                    console.log('Spot change response:', data);
                    this.playerId = data.playerId;
                    if (data.gameId) {
                        this.gameId = data.gameId;
                    }
                    // Remove player from old spot and add to new spot
                    this.removePlayerFromSpot(this.currentPlayer);
                    this.addPlayer(spotIndex, currentPlayerData.name);
                    this.playSound('buttonClick');
                })
                .catch(error => {
                    console.error('Error changing spot:', error);
                    alert('Failed to change spot. Please try again.');
                });
            }
            return;
        }
        
        // For new players who don't have a spot yet
        this.selectedSpot = spotIndex;
        const modal = document.getElementById('name-modal');
        const input = document.getElementById('player-name-input');
        input.value = '';
        modal.classList.add('active');
        input.focus();
    }

    hideNameModal() {
        const modal = document.getElementById('name-modal');
        modal.classList.remove('active');
        this.selectedSpot = null;
    }

    addPlayer(index, name) {
        // Remove player from any existing spot
        if (this.currentPlayer !== null) {
            this.players = this.players.filter(p => p.index !== this.currentPlayer);
        }

        // Add player to new spot
        this.players.push({
            index,
            name,
            points: 0,
            isAlive: true,
            isBot: false
        });

        // Set current player
        this.currentPlayer = index;

        try {
            // Update UI for all spots
            const joinBtns = document.querySelectorAll('.join-btn');
            const botBtns = document.querySelectorAll('.bot-btn');

            // Reset all spots first
            joinBtns.forEach((btn, i) => {
                if (!this.players.some(p => p.index === i)) {
                    btn.innerHTML = `Join Spot ${i + 1}`;
                    btn.classList.remove('occupied', 'other-player');
                    if (botBtns[i]) {
                        botBtns[i].style.display = 'block';
                    }
                }
            });

            // Update the selected spot
            if (joinBtns[index]) {
                const joinBtn = joinBtns[index];
        joinBtn.innerHTML = `
            <span class="status-icon">👤</span>
            <span class="player-name">${name}</span>
            <span class="spot-number">#${index + 1}</span>
                    <button class="leave-btn" onclick="window.game.leaveGame()">Leave</button>
        `;
        joinBtn.classList.add('occupied');

                // Hide bot button for occupied spot
                if (botBtns[index]) {
                    botBtns[index].style.display = 'none';
                }
            }
            
            // Update player count and start button
            const playersReadyElement = document.getElementById('players-ready');
            const startGameButton = document.getElementById('start-game');
            
            if (playersReadyElement) {
                playersReadyElement.textContent = this.players.length;
            }
            
            if (startGameButton) {
                startGameButton.disabled = this.players.length !== this.maxPlayers;
            }
        } catch (error) {
            console.error('Error updating UI in addPlayer:', error);
            // Remove the player if UI update fails
            this.players = this.players.filter(p => p.index !== index);
        this.currentPlayer = null;
            throw error;
        }
    }

    removePlayerFromSpot(index) {
        // Remove player from players array
        this.players = this.players.filter(p => p.index !== index);
        
        // Reset the join button
        const joinBtn = document.querySelectorAll('.join-btn')[index];
        if (joinBtn) {
        joinBtn.innerHTML = `Join Spot ${index + 1}`;
        joinBtn.classList.remove('occupied');
        }
        
        // Show the bot button again
        const botBtn = document.querySelectorAll('.bot-btn')[index];
        if (botBtn) {
        botBtn.style.display = 'block';
        }
        
        // Update player count and start button
        const playersReadyElement = document.getElementById('players-ready');
        const startGameButton = document.getElementById('start-game');
        
        if (playersReadyElement) {
            playersReadyElement.textContent = this.players.length;
        }
        
        if (startGameButton) {
            startGameButton.disabled = this.players.length !== this.maxPlayers;
        }
        
        this.currentPlayer = null;
    }

    updateWaitingRoom(players) {
        console.log('Updating waiting room with players:', players);
        
        // Reset all spots first
        const joinBtns = document.querySelectorAll('.join-btn');
        const botBtns = document.querySelectorAll('.bot-btn');
        
        joinBtns.forEach((btn, i) => {
            btn.innerHTML = `Join Spot ${i + 1}`;
            btn.classList.remove('occupied');
            if (botBtns[i]) {
                botBtns[i].style.display = 'block';
            }
        });

        // Update spots with current players
        players.forEach(player => {
            const index = player.spotIndex;
            if (joinBtns[index]) {
                const joinBtn = joinBtns[index];
                joinBtn.innerHTML = `
                    <span class="status-icon">${player.isBot ? '🤖' : '👤'}</span>
                    <span class="player-name">${player.name}</span>
                    <span class="spot-number">#${index + 1}</span>
                `;
                joinBtn.classList.add('occupied');

                // Hide bot button for occupied spot
                if (botBtns[index]) {
                    botBtns[index].style.display = 'none';
                }
            }
        });

        // Update player count and start button
        const playersReadyElement = document.getElementById('players-ready');
        const startGameButton = document.getElementById('start-game');
        
        if (playersReadyElement) {
            playersReadyElement.textContent = players.length;
        }
        
        if (startGameButton) {
            startGameButton.disabled = players.length !== this.maxPlayers;
        }

        // Store the current players
        this.players = players.map(p => ({
            index: p.spotIndex,
            name: p.name,
            isBot: p.isBot
        }));
    }

    updateRules(playerCount) {
        const rulesSection = document.querySelector('.rules-list');
        if (!rulesSection) return;

        // Base rules that always apply
        let rules = [
            {
                icon: '🎯',
                text: 'Select a number between 0 and 100'
            },
            {
                icon: '🎲',
                text: 'Target = Average × 0.8 (4/5ths)'
            },
            {
                icon: '👑',
                text: 'Player closest to target wins the round'
            },
            {
                icon: '⚠️',
                text: 'All losers lose 1 point'
            },
            {
                icon: '💀',
                text: 'Game Over: Reach -10 points'
            }
        ];

        // Add specific rules based on player count
        if (playerCount <= 4) {
            rules.push({
                icon: '🚫',
                text: 'Special Rule: Duplicate numbers are invalid and lose points'
            });
        }
        
        if (playerCount === 3) {
            rules.push({
                icon: '⚡',
                text: 'Special Rule: Exact target match doubles loser penalty (-2 points)'
            });
        }
        
        if (playerCount === 2) {
            rules.push({
                icon: '🎭',
                text: 'Final Rule: If one picks 0 and other picks 100, the 100 wins'
            });
        }

        // Add time rule based on player count
        rules.push({
            icon: '⏱️',
            text: playerCount === 5 ? 'Time Limit: 30 seconds per round' : 'Time Limit: 5 minutes (new rule adjustment period)'
        });

        // Update the rules display with a special header for new rules
        rulesSection.innerHTML = rules.map(rule => `
            <div class="rule-item">
                <span class="rule-icon">${rule.icon}</span>
                <span class="rule-text">${rule.text}</span>
            </div>
        `).join('');
    }

    handleGameStart(data) {
        console.log('Handling game start:', data);
        this.gameStarted = true;
        this.gameId = data.gameId;
        
        // Store all players' information including bots
        this.players = data.players.map(player => ({
            id: player.id,
            name: player.name,
            isBot: player.isBot,
            spotIndex: player.spotIndex
        }));

        // Hide the waiting room and show the game screen
        document.getElementById('login-screen').classList.remove('active');
        document.getElementById('game-screen').classList.add('active');

        // Initialize the game UI
        const gameScreen = document.getElementById('game-screen');
        if (gameScreen) {
            gameScreen.innerHTML = `
                <div class="game-container">
                    <div class="game-info">
                        <div class="rules-section">
                            <div class="section-header">
                                <h3>🎮 Active Rules</h3>
                                <div class="rule-divider"></div>
                            </div>
                            <div class="rules-list">
                                <!-- Rules will be dynamically updated -->
                            </div>
                        </div>
                        <div class="players-section">
                            <div class="section-header">
                                <h3>👥 Players</h3>
                                <div class="player-divider"></div>
                            </div>
                            <div class="players-grid">
                                ${this.players.map(player => `
                                    <div class="player-card ${player.id === this.playerId ? 'current-player' : ''}" data-player-id="${player.id}">
                                        <div class="player-header">
                                            <span class="player-icon">${player.isBot ? '🤖' : '👤'}</span>
                                            <span class="player-name">${player.name}</span>
                                        </div>
                                        <div class="player-stats">
                                            <div class="player-points">
                                                <span class="points-label">Points:</span>
                                                <span class="points-value">0</span>
                                            </div>
                                            <div class="player-status ${player.id === this.playerId ? 'my-turn' : ''}">
                                                Ready
                                            </div>
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    </div>

                    <div class="game-play">
                        <div class="round-header">
                            <div class="round-info">
                                <h2>Round <span class="round-number">1</span></h2>
                                <div class="timer">
                                    <span class="timer-icon">⏱️</span>
                                    <span class="time-remaining">${this.players.length === 5 ? '30' : '300'}</span>s
                                </div>
                            </div>
                        </div>

                        <div class="number-selection">
                            <div class="section-header">
                                <h3>🎯 Select Your Number</h3>
                            </div>
                            <div class="number-grid">
                                ${Array.from({length: 101}, (_, i) => i)
                                    .map(num => `
                                        <button class="number-btn" data-number="${num}">
                                            ${num}
                                        </button>
                                    `).join('')}
                            </div>
                            <button id="submit-number" class="submit-btn" disabled>
                                <span class="submit-icon">✨</span>
                                Submit Number
                            </button>
                        </div>

                        <div class="game-status">
                            <div class="status-message">Choose your number from the grid above...</div>
                            <div class="bot-messages"></div>
                        </div>
                    </div>

                    <div class="results-section">
                        <div class="section-header">
                            <h3>📊 Round Results</h3>
                            <div class="results-divider"></div>
                        </div>
                        <div class="results-content">
                            <div class="round-stats">
                                <div class="stat-item">
                                    <span class="stat-label">Average:</span>
                                    <span class="stat-value average">-</span>
                                </div>
                                <div class="stat-item">
                                    <span class="stat-label">Target:</span>
                                    <span class="stat-value target">-</span>
                                </div>
                            </div>
                            <div class="submitted-numbers">
                                <h4>📝 Submitted Numbers</h4>
                                <div class="numbers-list"></div>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            // Update rules based on initial player count
            this.updateRules(this.players.length);

            // Add event listeners to number buttons
            const numberBtns = document.querySelectorAll('.number-btn');
            numberBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    // Remove selected class from all buttons
                    numberBtns.forEach(b => b.classList.remove('selected'));
                    // Add selected class to clicked button
                    btn.classList.add('selected');
                    // Store selected number
                    this.selectedNumber = parseInt(btn.dataset.number);
                    // Enable submit button
                    const submitBtn = document.getElementById('submit-number');
                    submitBtn.disabled = false;
                    submitBtn.classList.add('ready');
                    // Play sound
                    this.playSound('buttonClick');
                    // Update status message
                    document.querySelector('.status-message').textContent = 
                        `Number ${this.selectedNumber} selected. Click Submit to confirm.`;
                });
            });

            // Add event listener to submit button
            document.getElementById('submit-number').addEventListener('click', () => {
                if (this.selectedNumber >= 0 && this.selectedNumber <= 100) {
                    this.submitNumber();
                    // Update status message
                    document.querySelector('.status-message').textContent = 
                        `Your number ${this.selectedNumber} has been submitted. Waiting for other players...`;
                    // Disable all number buttons and submit button
                    numberBtns.forEach(btn => {
                        btn.disabled = true;
                        btn.classList.add('disabled');
                    });
                    const submitBtn = document.getElementById('submit-number');
                    submitBtn.disabled = true;
                    submitBtn.classList.remove('ready');
                }
            });
        }

        // Start background music if not already playing
        if (this.sounds.bgMusic && this.sounds.bgMusic.paused) {
            this.sounds.bgMusic.play().catch(error => console.log('Background music autoplay prevented:', error));
        }

        // Start the timer for the first round
        this.startRoundTimer();
    }

    startRoundTimer() {
        // Clear any existing timer
        if (this.timer) {
            clearInterval(this.timer);
        }

        // Reset the time based on number of players
        this.remainingTime = this.players.length === 5 ? 30 : 300;

        // Update timer display
        const timerDisplay = document.querySelector('.time-remaining');
        if (timerDisplay) {
            timerDisplay.textContent = this.remainingTime;
        }

        // Start the countdown
        this.timer = setInterval(() => {
            this.remainingTime--;
            
            // Update timer display
            if (timerDisplay) {
                timerDisplay.textContent = this.remainingTime;
            }

            // Handle timer expiration
            if (this.remainingTime <= 0) {
                clearInterval(this.timer);
                // Auto-submit if player hasn't submitted yet
                if (this.selectedNumber !== undefined) {
                    this.submitNumber();
                }
            }
        }, 1000);
    }

    handleRoundResult(data) {
        console.log('Handling round result:', data);
        
        // Clear the current round timer
        if (this.timer) {
            clearInterval(this.timer);
        }

        // Update rules based on remaining players
        const alivePlayers = data.results.filter(r => r.isAlive).length;
        this.updateRules(alivePlayers);

        // Update round number and results display
        const roundNumber = document.querySelector('.round-number');
        const averageDisplay = document.querySelector('.average');
        const targetDisplay = document.querySelector('.target');
        const numbersList = document.querySelector('.numbers-list');

        // Clear previous submissions
        if (numbersList) {
            numbersList.innerHTML = '';
        }

        // Update average and target values immediately
        if (averageDisplay && typeof data.average === 'number') {
            averageDisplay.textContent = data.average.toFixed(2);
        }

        if (targetDisplay && typeof data.target === 'number') {
            targetDisplay.textContent = data.target.toFixed(2);
        }

        // Sort and display results
        if (data.results && data.results.length > 0) {
            // Sort results by distance (closest to target first)
            const sortedResults = [...data.results].sort((a, b) => a.distance - b.distance);
            
            // Update player cards and display results
            sortedResults.forEach(result => {
                // Update player card
                const playerCard = document.querySelector(`.player-card[data-player-id="${result.playerId}"]`);
                if (playerCard) {
                    // Update points
                    const pointsValue = playerCard.querySelector('.points-value');
                    if (pointsValue) {
                        pointsValue.textContent = result.totalPoints;
                        pointsValue.className = `points-value ${result.totalPoints < 0 ? 'negative' : ''}`;
                    }

                    // Update status
                    const statusDiv = playerCard.querySelector('.player-status');
                    if (statusDiv) {
                        if (!result.isAlive) {
                            statusDiv.textContent = 'Eliminated';
                            statusDiv.className = 'player-status eliminated';
                            playerCard.classList.add('eliminated');
                        } else if (result.isWinner) {
                            statusDiv.textContent = 'Winner!';
                            statusDiv.className = 'player-status winner';
                        } else {
                            statusDiv.textContent = 'Ready';
                            statusDiv.className = 'player-status';
                        }
                    }
                }

                // Add submission entry
                if (numbersList) {
                    const submissionEntry = document.createElement('div');
                    submissionEntry.className = `submission-entry ${result.isWinner ? 'winner' : ''} ${!result.isAlive ? 'eliminated' : ''} ${result.invalid ? 'invalid' : ''}`;
                    
                    submissionEntry.innerHTML = `
                        <div class="player-info">
                            <span class="player-icon">${result.isBot ? '🤖' : '👤'}</span>
                            <span class="player-name">${result.playerName}</span>
                        </div>
                        <div class="submission-details">
                            <span class="number-submitted">Number: ${result.number}</span>
                            <span class="distance">Distance: ${result.distance.toFixed(2)}</span>
                            <span class="points ${result.points < 0 ? 'negative' : ''}">Points: ${result.points > 0 ? '+' : ''}${result.points}</span>
                        </div>
                        <div class="status-badges">
                            ${result.isWinner ? '<span class="winner-badge">👑 Winner</span>' : ''}
                            ${result.invalid ? '<span class="invalid-badge">❌ Invalid</span>' : ''}
                            ${!result.isAlive ? '<span class="eliminated-badge">💀 Eliminated</span>' : ''}
                        </div>
                    `;
                    
                    numbersList.appendChild(submissionEntry);
                }
            });

            // Play appropriate sound effects
            if (data.results.some(r => !r.isAlive)) {
                this.playSound('elimination');
            } else if (data.results.some(r => r.isWinner)) {
                this.playSound('winner');
            }
        }

        // Clear bot messages
        const botMessages = document.querySelector('.bot-messages');
        if (botMessages) {
            botMessages.innerHTML = '';
        }

        // Start 10-second cooldown
        const statusMessage = document.querySelector('.status-message');
        if (statusMessage) {
            statusMessage.textContent = 'Next round starting in 10 seconds...';
        }

        // Disable all buttons during cooldown
        const numberBtns = document.querySelectorAll('.number-btn');
        const submitBtn = document.getElementById('submit-number');
        numberBtns.forEach(btn => {
            btn.disabled = true;
            btn.classList.remove('selected');
        });
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.classList.remove('ready');
        }

        // Create countdown display
        let countdown = 10;
        const countdownInterval = setInterval(() => {
            countdown--;
            if (statusMessage) {
                statusMessage.textContent = `Next round starting in ${countdown} seconds...`;
            }
            
            if (countdown <= 0) {
                clearInterval(countdownInterval);
                const currentPlayerResult = data.results.find(r => r.playerId === this.playerId);
                if (currentPlayerResult && currentPlayerResult.isAlive) {
                    // Increment round number
                    this.currentRound++;
                    if (roundNumber) {
                        roundNumber.textContent = this.currentRound;
                    }

                    // Re-enable buttons for next round
                    numberBtns.forEach(btn => {
                        btn.disabled = false;
                        btn.classList.remove('disabled');
                    });

                    // Update status message
                    if (statusMessage) {
                        statusMessage.textContent = 'Choose your number for the next round...';
                    }

                    // Start new round timer
                    this.startRoundTimer();
                }
            }
        }, 1000);
    }
}

// Initialize game when page loads
document.addEventListener('DOMContentLoaded', () => {
    window.game = new DeathGame();
}); 