class DeathGame {
    constructor() {
        this.serverUrl = 'https://borderland-1.onrender.com';
        
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
        this.playerName = null; // Store player's name
        
        this.setupAudio();
        this.initializeEventListeners();

        // Add state restoration on page load
        this.restoreGameState();
    }

    // Helper method to make fetch requests with CORS headers
    async fetchWithCORS(url, options = {}) {
        try {
            console.log('Making request to:', url);
            
            const response = await fetch(url, {
                ...options,
                method: options.method || 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                mode: 'cors'
            });
            
            // Log response details for debugging
            console.log('Response status:', response.status);
            console.log('Response headers:', {
                'content-type': response.headers.get('content-type'),
                'access-control-allow-origin': response.headers.get('access-control-allow-origin')
            });
            
            if (!response.ok) {
                let errorMessage;
                try {
                    const errorData = await response.text();
                    errorMessage = `Server error: ${response.status} - ${errorData}`;
                } catch (e) {
                    errorMessage = `Server error: ${response.status}`;
                }
                throw new Error(errorMessage);
            }
            
            return response;
        } catch (error) {
            console.error('Request failed:', error);
            // Add specific error handling for CORS errors
            if (error.message.includes('CORS')) {
                console.error('CORS error detected. Please ensure the server is configured correctly.');
                throw new Error('Unable to connect to server due to CORS policy. Please try again later.');
            }
            throw error;
        }
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
                this.startGame();
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

        // Add chat event listeners
        const chatInput = document.getElementById('chat-input');
        const sendButton = document.getElementById('send-message');

        if (chatInput && sendButton) {
            // Send message on button click
            sendButton.addEventListener('click', () => this.sendChatMessage());

            // Send message on Enter key
            chatInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.sendChatMessage();
                }
            });
        }

        // Add chat minimize functionality
        const chatHeaders = document.querySelectorAll('.chat-header');
        chatHeaders.forEach(header => {
            // Add minimize button to header
            const minimizeBtn = document.createElement('button');
            minimizeBtn.className = 'minimize-btn';
            minimizeBtn.innerHTML = '−';
            header.appendChild(minimizeBtn);

            header.addEventListener('click', (e) => {
                if (e.target === minimizeBtn || e.target === header) {
                    const chatBox = header.closest('.chat-box');
                    if (chatBox) {
                        chatBox.classList.toggle('minimized');
                        minimizeBtn.innerHTML = chatBox.classList.contains('minimized') ? '+' : '−';
                    }
                }
            });
        });

        // Add exit room button listener
        const exitButtons = document.querySelectorAll('.exit-room-btn');
        exitButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                if (confirm('Are you sure you want to exit the room?')) {
                    this.exitRoom();
                }
            });
        });
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

        this.fetchWithCORS(`${this.serverUrl}/create-room`, {
            method: 'POST',
            body: JSON.stringify({ roomId })
        })
        .then(response => response.json())
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
            alert('Failed to create room. Please try again.');
        });
    }

    joinRoom() {
        const roomInput = document.getElementById('room-number');
        const roomId = roomInput.value.trim();
        
        if (!roomId || roomId < 1 || roomId > 9999) {
            alert('Please enter a valid room number (1-9999)');
            return;
        }

        // Prevent multiple join attempts
        if (this.joiningRoom) {
            console.log('Already attempting to join room');
            return;
        }

        this.joiningRoom = true;

        // Clear existing game state
        this.clearGameState();

        this.fetchWithCORS(`${this.serverUrl}/join-room`, {
            method: 'POST',
            body: JSON.stringify({ roomId })
        })
        .then(response => response.json())
        .then(data => {
            console.log('Room joined:', data);
            
            if (data.gameStarted) {
                alert('Cannot join room - game already started');
                return;
            }

            this.roomId = data.roomId;
            
            // Only subscribe if we haven't already
            if (!this.gameChannel || this.gameChannel.name !== `game-channel-${this.roomId}`) {
                this.subscribeToRoom(this.roomId);
            }

            // Show login screen
            document.querySelectorAll('.screen').forEach(screen => {
                screen.style.display = 'none';
            });
            document.getElementById('login-screen').style.display = 'block';

            // Reset player spots
            const joinBtns = document.querySelectorAll('.join-btn');
            const botBtns = document.querySelectorAll('.bot-btn');
            
            // First reset all spots
            joinBtns.forEach((btn, i) => {
                btn.innerHTML = `Join Spot ${i + 1}`;
                btn.classList.remove('occupied');
                if (botBtns[i]) {
                    botBtns[i].style.display = 'block';
                }
            });

            // Then update with existing players
            if (data.players && data.players.length > 0) {
                data.players.forEach(player => {
                    const index = player.spotIndex;
                    if (joinBtns[index]) {
                        const joinBtn = joinBtns[index];
                        joinBtn.innerHTML = `
                            <span class="status-icon">${player.isBot ? '🤖' : '👤'}</span>
                            <span class="player-name">${player.name}</span>
                            <span class="spot-number">#${index + 1}</span>
                        `;
                        joinBtn.classList.add('occupied');
                        if (botBtns[index]) {
                            botBtns[index].style.display = 'none';
                        }
                    }
                });

                // Update players count
                const playersReadyElement = document.getElementById('players-ready');
                if (playersReadyElement) {
                    playersReadyElement.textContent = data.players.length;
                }

                // Update start button
                const startButton = document.getElementById('start-game');
                if (startButton) {
                    startButton.disabled = data.players.length !== this.maxPlayers;
                }
            } else {
                // Reset players count if no players
                const playersReadyElement = document.getElementById('players-ready');
                if (playersReadyElement) {
                    playersReadyElement.textContent = '0';
                }

                // Reset start button
                const startButton = document.getElementById('start-game');
                if (startButton) {
                    startButton.disabled = true;
                }
            }

            // Play sound effect
            this.playSound('buttonClick');
        })
        .catch(error => {
            console.error('Error joining room:', error);
            alert('Failed to join room. Room might not exist.');
        })
        .finally(() => {
            this.joiningRoom = false;
        });
    }

    clearGameState() {
        // Clear game state variables
        this.roomId = null;
        this.gameId = null;
        this.playerId = null;
        this.playerName = null;
        this.gameStarted = false;
        this.players = [];
        this.selectedNumber = undefined;
        this.currentRound = 1;
        this.selectedSpot = null;
        this.currentPlayer = null;
        
        // Clear localStorage
        localStorage.removeItem('gameState');

        // Unsubscribe from current channel
        if (this.gameChannel) {
            this.pusher.unsubscribe(this.gameChannel.name);
            this.gameChannel = null;
        }

        // Reset UI elements
        document.querySelectorAll('.screen').forEach(screen => {
            screen.style.display = 'none';
        });

        // Clear game board
        const gameBoard = document.querySelector('.game-board');
        if (gameBoard) {
            gameBoard.innerHTML = '';
        }

        // Clear results section
        const numbersList = document.querySelector('.numbers-list');
        if (numbersList) {
            numbersList.innerHTML = '';
        }

        // Reset round number and timer displays
        const roundNumber = document.querySelector('.round-number');
        if (roundNumber) {
            roundNumber.textContent = '1';
        }

        const timeRemaining = document.querySelector('.time-remaining');
        if (timeRemaining) {
            timeRemaining.textContent = '30';
        }

        // Clear chat messages
        const chatMessages = document.getElementById('chat-messages');
        if (chatMessages) {
            chatMessages.innerHTML = '';
        }

        // Clear any existing timers
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
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

        // Handle waiting room updates
        this.gameChannel.bind('waiting-room-update', (data) => {
            console.log('Received waiting room update:', data);
            this.updateWaitingRoom(data.players);
        });

        // Handle game start event
        this.gameChannel.bind('game-start', (data) => {
            console.log('Received game start event:', data);
            this.gameId = data.gameId;
            this.handleGameStart(data);
        });

        // Handle round results
        this.gameChannel.bind('round-result', (data) => {
            console.log('Received round result:', data);
            this.handleRoundResult(data);
        });

        // Log connection status
        this.gameChannel.bind('pusher:subscription_succeeded', () => {
            console.log('Successfully subscribed to game channel');
        });

        this.gameChannel.bind('pusher:subscription_error', (error) => {
            console.error('Error subscribing to game channel:', error);
        });

        // Add chat message binding
        this.gameChannel.bind('chat-message', (data) => {
            console.log('Received chat message:', data);
            this.displayChatMessage(data.playerName, data.message, data.playerId === this.playerId);
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

        // Check if name is already taken in the room
        if (this.players.some(p => p.name === name && !p.isBot)) {
            alert('This name is already taken. Please choose a different name.');
            return;
        }

        // Store player name for chat and future spot changes
        this.playerName = name;

        console.log('Attempting to join room:', {
            roomId: this.roomId,
            playerName: name,
            spotIndex: this.selectedSpot
        });

        this.fetchWithCORS(`${this.serverUrl}/join`, {
            method: 'POST',
            body: JSON.stringify({
                roomId: this.roomId,
                playerName: name,
                spotIndex: this.selectedSpot,
                isBot: false
            })
        })
        .then(response => response.json())
        .then(data => {
            console.log('Join successful:', data);
            
            // Store player ID and game ID
            this.playerId = data.playerId;
            this.currentPlayer = this.selectedSpot;
            if (data.gameId) {
                this.gameId = data.gameId;
            }

            // Update local players array with full player data
            this.players = data.players;

            // Update UI
            this.addPlayer(this.selectedSpot, name);
            this.hideNameModal();

            // Store game state in localStorage
            localStorage.setItem('gameState', JSON.stringify({
                roomId: this.roomId,
                gameId: this.gameId,
                playerId: this.playerId,
                playerName: this.playerName,
                currentSpot: this.selectedSpot,
                players: this.players
            }));

            // Play sound effect
            this.playSound('buttonClick');
        })
        .catch(error => {
            console.error('Detailed error joining game:', error);
            console.error('Error stack:', error.stack);
            alert('Failed to join game. Please try again.');
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

        this.fetchWithCORS(`${this.serverUrl}/join`, {
            method: 'POST',
            body: JSON.stringify({
                roomId: this.roomId,
                playerName: botName,
                spotIndex: Number(index),
                isBot: true
            })
        })
        .then(response => response.json())
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
        if (this.selectedNumber === undefined) {
            console.error('No number selected');
            return;
        }

        console.log('Submitting number:', this.selectedNumber);

        // Disable submit button to prevent multiple submissions
        const submitBtn = document.getElementById('submit-number');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Waiting for others...';
        }

        // Disable number grid
        document.querySelectorAll('.number-btn').forEach(btn => {
            btn.disabled = true;
        });

        // Update status message
        const statusMessage = document.querySelector('.status-message');
        if (statusMessage) {
            statusMessage.textContent = 'Number submitted! Waiting for other players...';
        }

        // First submit the human player's number
        this.fetchWithCORS(`${this.serverUrl}/submit-number`, {
            method: 'POST',
            body: JSON.stringify({
                roomId: this.roomId,
                gameId: this.gameId,
                playerId: this.playerId,
                number: this.selectedNumber
            })
        })
        .then(response => response.json())
        .then(data => {
            console.log('Human number submitted successfully:', data);
            
            // Update player card to show submitted number
            const playerCard = document.querySelector(`.player-card[data-player-id="${this.playerId}"]`);
            if (playerCard) {
                const roundDetails = playerCard.querySelector('.round-details');
                if (roundDetails) {
                    roundDetails.style.display = 'block';
                    const numberValue = roundDetails.querySelector('.detail-value');
                    if (numberValue) {
                        numberValue.textContent = this.selectedNumber;
                    }
                }
                const playerStatus = playerCard.querySelector('.player-status');
                if (playerStatus) {
                    playerStatus.textContent = 'Submitted';
                }
            }

            // Immediately submit bot numbers
            const botSubmissions = this.players
                .filter(p => p.isBot)
                .map(bot => {
                    const botNumber = Math.floor(Math.random() * 101);
                    return this.fetchWithCORS(`${this.serverUrl}/submit-number`, {
                        method: 'POST',
                        body: JSON.stringify({
                            roomId: this.roomId,
                            gameId: this.gameId,
                            playerId: bot.id,
                            number: botNumber
                        })
                    })
                    .then(response => response.json())
                    .then(botData => {
                        console.log(`Bot ${bot.id} submission:`, botData);
                        // Update bot's player card
                        const botCard = document.querySelector(`.player-card[data-player-id="${bot.id}"]`);
                        if (botCard) {
                            const botRoundDetails = botCard.querySelector('.round-details');
                            if (botRoundDetails) {
                                botRoundDetails.style.display = 'block';
                                const botNumberValue = botRoundDetails.querySelector('.detail-value');
                                if (botNumberValue) {
                                    botNumberValue.textContent = botNumber;
                                }
                            }
                            const botStatus = botCard.querySelector('.player-status');
                            if (botStatus) {
                                botStatus.textContent = 'Submitted';
                            }
                        }
                        return botData;
                    });
                });

            // Wait for all bot submissions to complete
            return Promise.all(botSubmissions);
        })
        .catch(error => {
            console.error('Error submitting numbers:', error);
            // Re-enable submit button if there was an error
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Submit Number';
            }
            // Re-enable number grid
            document.querySelectorAll('.number-btn').forEach(btn => {
                btn.disabled = false;
            });
            alert(`Failed to submit number: ${error.message}`);
        });
    }

    // Helper method to submit numbers to the server
    submitNumberToServer(roomId, gameId, playerId, number) {
        console.log('Submitting to server:', { roomId, gameId, playerId, number });
        return this.fetchWithCORS(`${this.serverUrl}/submit-number`, {
            method: 'POST',
            body: JSON.stringify({
                roomId: roomId,
                gameId: gameId,
                playerId: playerId,
                number: number
            })
        })
        .then(response => response.json())
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

        this.fetchWithCORS(`${this.serverUrl}/leave`, {
            method: 'POST',
            body: JSON.stringify({
                roomId: this.roomId,
                playerId: this.playerId,
                spotIndex: this.currentPlayer
            })
        })
        .then(response => response.json())
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
            elimination: document.getElementById('eliminationSound'),
            message: document.getElementById('messageSound')
        };

        // Set volumes
        this.sounds.bgMusic.volume = 0.3;
        this.sounds.buttonClick.volume = 0.5;
        this.sounds.submit.volume = 0.6;
        this.sounds.winner.volume = 0.7;
        this.sounds.elimination.volume = 0.6;
        this.sounds.message.volume = 0.5;

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
        const joinBtns = document.querySelectorAll('.join-btn');
        if (joinBtns[spotIndex].classList.contains('occupied')) {
            alert('This spot is already taken!');
            return;
        }

        // If user already has a spot, handle spot change
        if (this.playerId) {
            console.log('Changing spot from', this.currentPlayer, 'to', spotIndex);
            
            this.fetchWithCORS(`${this.serverUrl}/leave`, {
                method: 'POST',
                body: JSON.stringify({
                    roomId: this.roomId,
                    playerId: this.playerId,
                    spotIndex: this.currentPlayer
                })
            })
            .then(response => response.json())
            .then(() => {
                // After successfully leaving, join the new spot with the same name
                return this.fetchWithCORS(`${this.serverUrl}/join`, {
                    method: 'POST',
                    body: JSON.stringify({
                        roomId: this.roomId,
                        playerName: this.playerName,
                        spotIndex: spotIndex,
                        isBot: false
                    })
                });
            })
            .then(response => response.json())
            .then(data => {
                console.log('Spot change successful:', data);
                this.playerId = data.playerId;
                this.currentPlayer = spotIndex;
                if (data.gameId) {
                    this.gameId = data.gameId;
                }
                this.playSound('buttonClick');
            })
            .catch(error => {
                console.error('Error changing spot:', error);
                alert('Failed to change spot. Please try again.');
            });
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
        this.players = data.players;
        
        // Hide all other screens first
        document.querySelectorAll('.screen').forEach(screen => {
            if (screen.id !== 'game-screen') {
                screen.style.display = 'none';
            }
        });

        // Get and clear game screen
        const gameScreen = document.getElementById('game-screen');
        if (gameScreen) {
            gameScreen.innerHTML = ''; // Clear existing content
            gameScreen.style.display = 'block';
            gameScreen.style.background = '#1a1f25';
            gameScreen.style.minHeight = '100vh';
            gameScreen.style.width = '100%';
            
            // Store game state
            localStorage.setItem('gameState', JSON.stringify({
                roomId: this.roomId,
                gameId: this.gameId,
                playerId: this.playerId,
                playerName: this.playerName,
                gameStarted: true,
                players: this.players
            }));

            // Create game layout
            const gameLayout = document.createElement('div');
            gameLayout.className = 'game-layout';

            // Create rules section
            const rulesSection = document.createElement('div');
            rulesSection.className = 'rules-section';
            rulesSection.innerHTML = `
                <h3>Game Rules</h3>
                <div class="rules-list"></div>
            `;

            // Create game content
            const gameContent = document.createElement('div');
            gameContent.className = 'game-content';

            // Create game board
            const gameBoard = document.createElement('div');
            gameBoard.className = 'game-board';

            // Add timer display
            const timerDisplay = document.createElement('div');
            timerDisplay.className = 'timer-display';
            timerDisplay.innerHTML = `
                <span>Time Remaining: </span>
                <span class="time-remaining">-</span>
            `;
            gameBoard.appendChild(timerDisplay);

            // Create players grid inside game board
            const playersGrid = document.createElement('div');
            playersGrid.className = 'players-grid';
            this.players.forEach(player => {
                const playerCard = document.createElement('div');
                playerCard.className = `player-card ${player.id === this.playerId ? 'current-player' : ''}`;
                playerCard.dataset.playerId = player.id;
                playerCard.innerHTML = `
                    <div class="player-header">
                        <span class="player-icon">${player.isBot ? '🤖' : '👤'}</span>
                        <span class="player-name">${player.name}</span>
                    </div>
                    <div class="player-stats">
                        <div class="player-points">
                            <span class="points-label">Points:</span>
                            <span class="points-value">0</span>
                        </div>
                        <div class="player-status">Ready</div>
                    </div>
                    <div class="round-details" style="display: none;">
                        <div class="round-detail-item">
                            <span class="detail-label">Number:</span>
                            <span class="detail-value">-</span>
                        </div>
                        <div class="round-detail-item">
                            <span class="detail-label">Distance:</span>
                            <span class="detail-value">-</span>
                        </div>
                        <div class="round-detail-item">
                            <span class="detail-label">Result:</span>
                            <span class="detail-value">-</span>
                        </div>
                    </div>
                `;
                playersGrid.appendChild(playerCard);
            });
            gameBoard.appendChild(playersGrid);

            // Create number grid
            const numberGridContainer = document.createElement('div');
            numberGridContainer.className = 'number-grid';
            for (let i = 0; i <= 100; i++) {
                const button = document.createElement('button');
                button.className = 'number-btn';
                button.textContent = i;
                button.dataset.number = i;
                button.addEventListener('click', () => {
                    document.querySelectorAll('.number-btn').forEach(btn => {
                        btn.classList.remove('selected');
                    });
                    button.classList.add('selected');
                    this.selectedNumber = i;
                    const submitBtn = document.getElementById('submit-number');
                    if (submitBtn) {
                        submitBtn.disabled = false;
                    }
                });
                numberGridContainer.appendChild(button);
            }
            gameBoard.appendChild(numberGridContainer);

            // Add submit button
            const submitButton = document.createElement('button');
            submitButton.id = 'submit-number';
            submitButton.className = 'submit-btn';
            submitButton.disabled = true;
            submitButton.textContent = 'Submit Number';
            submitButton.addEventListener('click', () => this.submitNumber());
            gameBoard.appendChild(submitButton);

            // Add status message
            const statusMessage = document.createElement('div');
            statusMessage.className = 'status-message';
            statusMessage.textContent = 'Choose your number...';
            gameBoard.appendChild(statusMessage);

            // Assemble the game layout
            gameContent.appendChild(gameBoard);
            gameLayout.appendChild(rulesSection);
            gameLayout.appendChild(gameContent);

            // Add game layout directly to game screen
            gameScreen.appendChild(gameLayout);

            // Update rules based on player count
            this.updateRules(this.players.length);

            // Start the round timer
            this.startRoundTimer();

            // Play game start sound
            this.playSound('buttonClick');
        }
    }

    startGame() {
        if (!this.roomId) {
            console.error('No room ID found');
            alert('Please join a room first');
            return;
        }

        console.log('Starting game in room:', this.roomId);

        // Disable start button to prevent multiple clicks
        const startButton = document.getElementById('start-game');
        if (startButton) {
            startButton.disabled = true;
            startButton.textContent = 'Starting game...';
        }

        // Ensure we're subscribed to the correct channel
        if (!this.gameChannel || this.gameChannel.name !== `game-channel-${this.roomId}`) {
            console.log('Resubscribing to game channel');
            this.subscribeToRoom(this.roomId);
        }

        this.fetchWithCORS(`${this.serverUrl}/start-game`, {
            method: 'POST',
            body: JSON.stringify({
                roomId: this.roomId
            })
        })
        .then(response => response.json())
        .then(data => {
            console.log('Game started successfully:', data);
            this.gameId = data.gameId;
            this.gameStarted = true;
            this.players = data.players;

            // Keep the game screen visible and remove other screens
            document.querySelectorAll('.screen').forEach(screen => {
                if (screen.id === 'game-screen') {
                    screen.classList.add('active');
                } else {
                    screen.classList.remove('active');
                }
            });

            // Store the current game state
            localStorage.setItem('gameState', JSON.stringify({
                roomId: this.roomId,
                gameId: this.gameId,
                playerId: this.playerId,
                playerName: this.playerName,
                gameStarted: true,
                players: this.players
            }));

            // Initialize game UI
            this.initializeGameUI();
        })
        .catch(error => {
            console.error('Error starting game:', error);
            // Re-enable the start button if there was an error
            if (startButton) {
                startButton.disabled = false;
                startButton.textContent = 'Start Game';
            }
            alert(`Failed to start game: ${error.message}`);
        });
    }

    initializeGameUI() {
        // Initialize player cards
        const playersGrid = document.createElement('div');
        playersGrid.className = 'players-grid';
        this.players.forEach(player => {
            const playerCard = document.createElement('div');
            playerCard.className = `player-card ${player.id === this.playerId ? 'current-player' : ''}`;
            playerCard.dataset.playerId = player.id;
            playerCard.innerHTML = `
                <div class="player-header">
                    <span class="player-icon">${player.isBot ? '🤖' : '👤'}</span>
                    <span class="player-name">${player.name}</span>
                </div>
                <div class="player-stats">
                    <div class="player-points">
                        <span class="points-label">Points:</span>
                        <span class="points-value">0</span>
                    </div>
                    <div class="player-status">Ready</div>
                </div>
            `;
            playersGrid.appendChild(playerCard);
        });

        // Clear and update game board
        const gameBoard = document.querySelector('.game-board');
        if (gameBoard) {
            gameBoard.innerHTML = '';
            gameBoard.appendChild(playersGrid);

            // Add number grid
            const numberGridContainer = document.createElement('div');
            numberGridContainer.className = 'number-grid';
            for (let i = 0; i <= 100; i++) {
                const button = document.createElement('button');
                button.className = 'number-btn';
                button.textContent = i;
                button.dataset.number = i;
                button.addEventListener('click', () => {
                    document.querySelectorAll('.number-btn').forEach(btn => {
                        btn.classList.remove('selected');
                    });
                    button.classList.add('selected');
                    this.selectedNumber = i;
                    const submitBtn = document.getElementById('submit-number');
                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.classList.add('ready');
                    }
                });
                numberGridContainer.appendChild(button);
            }
            gameBoard.appendChild(numberGridContainer);

            // Add submit button
            const submitButton = document.createElement('button');
            submitButton.id = 'submit-number';
            submitButton.className = 'submit-btn';
            submitButton.disabled = true;
            submitButton.textContent = 'Submit Number';
            submitButton.addEventListener('click', () => this.submitNumber());
            gameBoard.appendChild(submitButton);
        }

        // Initialize round number and timer
        const roundNumber = document.querySelector('.round-number');
        if (roundNumber) {
            roundNumber.textContent = this.currentRound;
        }

        const timeRemaining = document.querySelector('.time-remaining');
        if (timeRemaining) {
            timeRemaining.textContent = this.players.length === 5 ? '30' : '300';
        }

        // Start the round timer
        this.startRoundTimer();

        // Play game start sound
        this.playSound('buttonClick');
    }

    sendChatMessage() {
        const chatInput = document.getElementById('chat-input');
        const message = chatInput.value.trim();

        if (!message) {
            console.log('No message to send');
            return;
        }

        if (!this.roomId || !this.playerId || !this.playerName) {
            console.error('Missing required data:', {
                roomId: this.roomId,
                playerId: this.playerId,
                playerName: this.playerName
            });
            alert('Please join a room first');
            return;
        }

        console.log('Sending chat message:', {
            roomId: this.roomId,
            playerId: this.playerId,
            playerName: this.playerName,
            message: message
        });

        this.fetchWithCORS(`${this.serverUrl}/send-message`, {
            method: 'POST',
            body: JSON.stringify({
                roomId: this.roomId,
                playerId: this.playerId,
                playerName: this.playerName,
                message: message
            })
        })
        .then(response => response.json())
        .then(data => {
            console.log('Message sent successfully:', data);
            chatInput.value = ''; // Clear input after successful send
        })
        .catch(error => {
            console.error('Error sending message:', error);
            alert('Failed to send message. Please try again.');
        });
    }

    displayChatMessage(playerName, message, isOwnMessage) {
        const chatMessages = document.getElementById('chat-messages');
        if (!chatMessages) return;

        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-message ${isOwnMessage ? 'own' : 'other'}`;

        const messageInfo = document.createElement('div');
        messageInfo.className = 'message-info';
        messageInfo.textContent = isOwnMessage ? 'You' : playerName;

        const messageContent = document.createElement('div');
        messageContent.className = 'message-content';
        messageContent.textContent = message;

        messageDiv.appendChild(messageInfo);
        messageDiv.appendChild(messageContent);
        chatMessages.appendChild(messageDiv);

        // Scroll to bottom
        chatMessages.scrollTop = chatMessages.scrollHeight;

        // Play message sound
        this.playSound('message');

        // Unminimize chat box when new message arrives
        const chatBox = chatMessages.closest('.chat-box');
        if (chatBox && chatBox.classList.contains('minimized')) {
            chatBox.classList.remove('minimized');
            const minimizeBtn = chatBox.querySelector('.minimize-btn');
            if (minimizeBtn) {
                minimizeBtn.innerHTML = '−';
            }
        }
    }

    // Add method to restore game state
    restoreGameState() {
        const savedState = localStorage.getItem('gameState');
        if (savedState) {
            const state = JSON.parse(savedState);
            if (state.gameStarted) {
                this.roomId = state.roomId;
                this.gameId = state.gameId;
                this.playerId = state.playerId;
                this.playerName = state.playerName;
                this.gameStarted = true;

                // Show game screen
                document.querySelectorAll('.screen').forEach(screen => {
                    if (screen.id === 'game-screen') {
                        screen.classList.add('active');
                    } else {
                        screen.classList.remove('active');
                    }
                });
            }
        }
    }

    exitRoom() {
        // Clear game state
        this.roomId = null;
        this.gameId = null;
        this.playerId = null;
        this.playerName = null;
        this.gameStarted = false;
        this.players = [];
        this.selectedNumber = undefined;
        
        // Clear localStorage
        localStorage.removeItem('gameState');

        // Unsubscribe from current channel
        if (this.gameChannel) {
            this.pusher.unsubscribe(this.gameChannel.name);
            this.gameChannel = null;
        }

        // Reset UI elements
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
        document.getElementById('room-screen').classList.add('active');

        // Clear room number input
        const roomInput = document.getElementById('room-number');
        if (roomInput) {
            roomInput.value = '';
        }

        // Play sound effect
        this.playSound('buttonClick');
    }

    startRoundTimer() {
        console.log('Starting round timer');
        // Clear any existing timer
        if (this.timer) {
            clearInterval(this.timer);
        }

        // Reset the time based on number of players
        this.remainingTime = this.players.length === 5 ? 30 : 300;
        console.log('Initial time:', this.remainingTime);

        // Update timer display
        const timerDisplay = document.querySelector('.time-remaining');
        if (timerDisplay) {
            timerDisplay.textContent = this.remainingTime;
            console.log('Timer display updated:', this.remainingTime);
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
                console.log('Timer expired');
                clearInterval(this.timer);
                
                // Auto-submit for human player if they haven't submitted
                const playerCard = document.querySelector(`.player-card[data-player-id="${this.playerId}"]`);
                const roundDetails = playerCard?.querySelector('.round-details');
                if (playerCard && roundDetails && roundDetails.style.display !== 'block') {
                    console.log('Auto-submitting for human player');
                    this.selectedNumber = Math.floor(Math.random() * 101);
                    this.submitNumber();
                }

                // Auto-submit for bots that haven't submitted
                const unsubmittedBots = this.players.filter(p => {
                    if (!p.isBot) return false;
                    const botCard = document.querySelector(`.player-card[data-player-id="${p.id}"]`);
                    const botRoundDetails = botCard?.querySelector('.round-details');
                    return botCard && botRoundDetails && botRoundDetails.style.display !== 'block';
                });
                
                if (unsubmittedBots.length > 0) {
                    console.log('Auto-submitting for unsubmitted bots:', unsubmittedBots);
                    unsubmittedBots.forEach(bot => {
                        const botNumber = Math.floor(Math.random() * 101);
                        this.fetchWithCORS(`${this.serverUrl}/submit-number`, {
                            method: 'POST',
                            body: JSON.stringify({
                                roomId: this.roomId,
                                gameId: this.gameId,
                                playerId: bot.id,
                                number: botNumber
                            })
                        })
                        .then(response => response.json())
                        .then(data => console.log(`Auto-submit for bot ${bot.id}:`, data))
                        .catch(error => console.error(`Error auto-submitting for bot ${bot.id}:`, error));
                    });
                }
            }
        }, 1000);
    }

    handleRoundResult(data) {
        console.log('Handling round result:', data);
        if (!data || !data.results) {
            console.error('Invalid round result data:', data);
            return;
        }

        const { round, average, target, results } = data;
        const winner = results.find(r => r.isWinner)?.playerId;
        const eliminated = results.filter(r => r.isEliminated).map(r => r.playerId);
        const submissions = {};

        // Convert results array to submissions object
        results.forEach(result => {
            submissions[result.playerId] = {
                number: result.number,
                distance: result.distance,
                points: result.points,
                isWinner: result.isWinner,
                isEliminated: result.isEliminated
            };
        });

        // Update player cards with round results
        Object.entries(submissions).forEach(([playerId, submission]) => {
            const playerCard = document.querySelector(`.player-card[data-player-id="${playerId}"]`);
            if (playerCard) {
                // Show round details
                const roundDetails = playerCard.querySelector('.round-details');
                if (roundDetails) {
                    roundDetails.style.display = 'block';
                    
                    // Update number
                    const numberValue = roundDetails.querySelector('.detail-value');
                    if (numberValue) numberValue.textContent = submission.number;

                    // Update distance
                    const distanceValue = roundDetails.querySelector('.detail-value:nth-child(2)');
                    if (distanceValue) distanceValue.textContent = submission.distance.toFixed(2);

                    // Update result
                    const resultValue = roundDetails.querySelector('.detail-value:last-child');
                    if (resultValue) {
                        if (submission.isWinner) {
                            resultValue.textContent = 'Winner!';
                            resultValue.classList.add('winner');
                            playerCard.classList.add('winner');
                        } else if (submission.isEliminated) {
                            resultValue.textContent = 'Eliminated';
                            resultValue.classList.add('negative');
                            playerCard.classList.add('eliminated');
                        } else {
                            resultValue.textContent = '-1 point';
                            resultValue.classList.add('negative');
                        }
                    }
                }

                // Update points
                const pointsValue = playerCard.querySelector('.points-value');
                if (pointsValue) {
                    pointsValue.textContent = submission.points;
                    pointsValue.className = 'points-value ' + (submission.points >= 0 ? 'positive' : 'negative');
                }

                // Update status
                const playerStatus = playerCard.querySelector('.player-status');
                if (playerStatus) {
                    if (submission.isEliminated) {
                        playerStatus.textContent = 'Eliminated';
                        playerStatus.classList.add('eliminated');
                    } else if (submission.isWinner) {
                        playerStatus.textContent = 'Winner';
                        playerStatus.classList.add('winner');
                    } else {
                        playerStatus.textContent = 'Ready';
                    }
                }
            }
        });

        // Update status message
        const statusMessage = document.querySelector('.status-message');
        if (statusMessage) {
            statusMessage.innerHTML = `
                Round ${round} Complete!<br>
                Average: ${average.toFixed(2)}<br>
                Target: ${target.toFixed(2)}
            `;
        }

        // Reset for next round if not eliminated
        const isPlayerEliminated = eliminated.includes(this.playerId);
        if (!isPlayerEliminated) {
            this.selectedNumber = undefined;
            const submitBtn = document.getElementById('submit-number');
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = 'Submit Number';
            }
            // Remove selection from number grid
            document.querySelectorAll('.number-btn').forEach(btn => {
                btn.classList.remove('selected');
                btn.disabled = false;
            });
        }

        // Start new round timer after a short delay
        setTimeout(() => {
            if (!isPlayerEliminated) {
                this.startRoundTimer();
            }
        }, 3000);
    }
}

// Initialize game when page loads
document.addEventListener('DOMContentLoaded', () => {
    window.game = new DeathGame();
}); 