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

        fetch(`${this.serverUrl}/create-room`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ roomId })
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            console.log('Room created:', data);
            this.roomId = data.roomId;
            this.subscribeToRoom(this.roomId);
            document.getElementById('room-screen').classList.remove('active');
            document.getElementById('login-screen').classList.add('active');
        })
        .catch(error => {
            console.error('Error creating room:', error);
            alert('Failed to create room. Room might already exist.');
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
            console.log('Round result received:', data);
            this.handleRoundResult(data);
        });

        this.gameChannel.bind('bot-submit', data => {
            console.log('Bot submission received:', data);
            const numberInput = document.querySelector('.number-input');
            if (numberInput) {
                const existingMessage = numberInput.querySelector('.bot-submission');
                if (existingMessage) {
                    existingMessage.textContent = `${data.botName} submitted their number...`;
                } else {
                    const botMessage = document.createElement('div');
                    botMessage.className = 'bot-submission';
                    botMessage.textContent = `${data.botName} submitted their number...`;
                    numberInput.appendChild(botMessage);
                }
            }
        });
    }

    // Update other methods to include roomId in requests
    confirmJoin() {
        const nameInput = document.getElementById('player-name-input');
        const name = nameInput.value.trim();
        
        if (name && this.selectedSpot !== null && this.roomId) {
            fetch(`${this.serverUrl}/join`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    roomId: this.roomId,
                    playerName: name,
                    spotIndex: this.selectedSpot
                })
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                console.log('Join response:', data);
                this.playerId = data.playerId;
                if (data.gameId) {
                    this.gameId = data.gameId;
                }
                this.addPlayer(this.selectedSpot, name);
            })
            .catch(error => {
                console.error('Error joining game:', error);
                alert('Failed to join game. Please try again.');
            });
            this.hideNameModal();
        }
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
        
        fetch(`${this.serverUrl}/join`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                roomId: this.roomId,
                playerName: botName,
                spotIndex: index,
                isBot: true
            })
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            console.log('Bot join response:', data);
            // Bot joining is handled through waiting room update
        })
        .catch(error => {
            console.error('Error adding bot:', error);
            alert('Failed to add bot. Please try again.');
        });
    }

    submitNumber() {
        if (typeof this.selectedNumber === 'undefined') {
            alert('Please select a number');
            return;
        }

        if (!this.gameId || !this.playerId || !this.roomId) {
            console.error('Missing required IDs');
            return;
        }

        const submitButton = document.getElementById('submit-number');
        if (submitButton) {
            submitButton.disabled = true;
        }

        fetch(`${this.serverUrl}/submit-number`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                roomId: this.roomId,
                gameId: this.gameId,
                playerId: this.playerId,
                number: this.selectedNumber
            })
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            console.log('Number submission response:', data);
            const numberInput = document.querySelector('.number-input');
            if (numberInput) {
                numberInput.innerHTML = `
                    <div class="waiting-message">
                        Your number ${this.selectedNumber} has been submitted.
                        <br>
                        Waiting for other players...
                    </div>
                `;
            }
            this.selectedNumber = undefined;
        })
        .catch(error => {
            console.error('Error submitting number:', error);
            alert('Failed to submit number. Please try again.');
            if (submitButton) {
                submitButton.disabled = false;
            }
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
}

// Initialize game when page loads
document.addEventListener('DOMContentLoaded', () => {
    window.game = new DeathGame();
}); 