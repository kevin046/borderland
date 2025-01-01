class DeathGame {
    constructor() {
        this.pusher = new Pusher('e6a64e50330db39ab319', {
            cluster: 'us2'
        });
        this.gameChannel = this.pusher.subscribe('game-channel');
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
        this.setupAudio();
        this.initializeEventListeners();
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

    initializeEventListeners() {
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

        // If player already has a spot, handle spot change
        if (this.currentPlayer !== null) {
            // Remove player from current spot
            this.removePlayerFromSpot(this.currentPlayer);
            // Add player to new spot with same name
            const playerName = this.players.find(p => p.index === this.currentPlayer)?.name;
            if (playerName) {
                this.selectedSpot = spotIndex;
                fetch('/join', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        playerName: playerName,
                        spotIndex: spotIndex
                    })
                })
                .then(response => response.json())
                .then(data => {
                    console.log('Spot change response:', data);
                    this.playerId = data.playerId;
                    if (data.gameId) {
                        this.gameId = data.gameId;
                    }
                    this.addPlayer(spotIndex, playerName);
                })
                .catch(error => {
                    console.error('Error changing spot:', error);
                    alert('Failed to change spot. Please try again.');
                });
            }
            return;
        }

        // For new players, show the name modal
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

    confirmJoin() {
        const nameInput = document.getElementById('player-name-input');
        const name = nameInput.value.trim();
        
        if (name && this.selectedSpot !== null) {
            fetch('/join', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    playerName: name,
                    spotIndex: this.selectedSpot
                })
            })
            .then(response => response.json())
            .then(data => {
                console.log('Join response:', data);
                this.playerId = data.playerId;
                if (data.gameId) {
                    this.gameId = data.gameId;
                }
                // Add player locally after successful join
                this.addPlayer(this.selectedSpot, name);
            })
            .catch(error => {
                console.error('Error joining game:', error);
                alert('Failed to join game. Please try again.');
            });
            this.hideNameModal();
        }
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

    startGame() {
        if (!this.gameId || !this.playerId) {
            console.error('Cannot start game: missing gameId or playerId', {
                gameId: this.gameId,
                playerId: this.playerId
            });
            return;
        }

        console.log('Starting game:', {
            gameId: this.gameId,
            playerId: this.playerId,
            players: this.players
        });

        // Start background music with error handling
        const playPromise = this.sounds.bgMusic.play();
        if (playPromise !== undefined) {
            playPromise.catch(error => {
                console.error('Error playing background music:', error);
            });
        }

        document.getElementById('login-screen').classList.remove('active');
        document.getElementById('game-screen').classList.add('active');
        
        // Update UI with current players
        this.updatePlayersGrid();
        
        // Start the first round
        this.startRound();
    }

    startRound() {
        if (!this.gameId || !this.playerId) {
            console.error('Cannot start round: missing gameId or playerId');
            return;
        }

        // Reset input state and create number table
        this.createNumberTable();
        
        // Find submit button and disable it
        const submitButton = document.getElementById('submit-number');
        if (submitButton) {
            submitButton.disabled = true;
        }

        // Set time limit based on round type
        const alivePlayers = this.players.filter(p => p.isAlive).length;
        const isNewRuleRound = this.currentRound === 1 || 
            alivePlayers === 4 || alivePlayers === 3 || alivePlayers === 2;
        this.remainingTime = isNewRuleRound ? 60 : 30;

        // Update the time display immediately
        const timeElement = document.getElementById('time');
        if (timeElement) {
            timeElement.textContent = this.remainingTime;
        }

        // Clear any existing timer
        if (this.timer) {
            clearInterval(this.timer);
        }

        this.updateTimer();
        this.timer = setInterval(() => this.updateTimer(), 1000);
        this.updateRules();

        // Update round number display
        const roundElement = document.getElementById('round-number');
        if (roundElement) {
            roundElement.textContent = this.currentRound;
        }

        console.log('Round started:', {
            roundNumber: this.currentRound,
            timeLimit: this.remainingTime,
            players: this.players
        });
    }

    updateTimer() {
        this.remainingTime--;
        const timeElement = document.getElementById('time');
        if (timeElement) {
            timeElement.textContent = this.remainingTime;
        }
        
        // Show warning when 5 seconds remaining
        if (this.remainingTime === 5) {
            const numberInput = document.querySelector('.number-input');
            if (numberInput && !this.selectedNumber) {
                const warningDiv = document.createElement('div');
                warningDiv.className = 'time-warning';
                warningDiv.textContent = 'Time running out! Number will be auto-selected!';
                numberInput.appendChild(warningDiv);
            }
        }
        
        if (this.remainingTime <= 0) {
            clearInterval(this.timer);
            this.endRound();
        }
    }

    updateRules() {
        const rulesElement = document.getElementById('current-rules');
        let rules = ['• All players select a number between 0 and 100',
                     '• The average × 0.8 closest number wins',
                     '• Losers lose 1 point'];

        const alivePlayers = this.players.filter(p => p.isAlive).length;

        if (alivePlayers <= 4) {
            rules.push('• If two or more players choose the same number, those numbers become invalid');
        }
        if (alivePlayers <= 3) {
            rules.push('• If someone matches the target exactly, other players lose 2 points instead of 1');
        }
        if (alivePlayers <= 2) {
            rules.push('• Special rule: If one player chooses 0 and the other chooses 100, the player who chose 100 wins');
        }

        rulesElement.innerHTML = rules.join('<br>');
    }

    updatePlayersGrid() {
        const grid = document.querySelector('.players-grid');
        grid.innerHTML = '';

        // Find current human player
        const humanPlayer = this.players.find(p => !p.isBot && p.isAlive);

        this.players.forEach(player => {
            const card = document.createElement('div');
            card.className = `player-card ${player.isAlive ? '' : 'eliminated'} ${player.isBot ? 'bot' : ''}`;
            card.innerHTML = `
                <h3>${player.name}</h3>
                <p class="points">Points: ${player.points}</p>
                ${player === humanPlayer ? '<span class="you-indicator">YOU</span>' : ''}
                ${player.isBot ? '<span class="bot-label">(BOT)</span>' : ''}
            `;
            grid.appendChild(card);
        });
    }

    createNumberTable() {
        const numberInput = document.querySelector('.number-input');
        if (!numberInput) return;

        numberInput.innerHTML = `
            <div class="number-table">
                <div class="table-header">
                    <div class="table-title">Select your number (0-100)</div>
                    <button id="submit-number" disabled>Submit</button>
                </div>
                <div class="number-grid"></div>
            </div>
        `;

        const numberGrid = numberInput.querySelector('.number-grid');
        if (!numberGrid) return;
        
        // Create organized 10x10 grid (plus row for multiples of 10)
        for (let row = 0; row <= 10; row++) {
            const rowDiv = document.createElement('div');
            rowDiv.className = 'number-row';
            
            for (let col = 0; col < 10; col++) {
                const number = row * 10 + col;
                if (number <= 100) {  // Only create cells for numbers 0-100
                    const numberCell = document.createElement('div');
                    numberCell.className = 'number-cell';
                    numberCell.textContent = number;
                    numberCell.addEventListener('click', () => this.selectNumber(number, numberCell));
                    rowDiv.appendChild(numberCell);
                }
            }
            
            numberGrid.appendChild(rowDiv);
        }

        // Add event listener to the newly created submit button
        const submitButton = document.getElementById('submit-number');
        if (submitButton) {
            submitButton.addEventListener('click', () => this.submitNumber());
        }
    }

    selectNumber(number, cell) {
        if (!this.gameStarted) return;
        
        this.playSound('buttonClick');
        // Remove previous selection
        const previousSelected = document.querySelector('.number-cell.selected');
        if (previousSelected) {
            previousSelected.classList.remove('selected');
        }

        // Add new selection
        cell.classList.add('selected');
        
        // Enable submit button
        const submitButton = document.getElementById('submit-number');
        if (submitButton) {
            submitButton.disabled = false;
        }
        
        // Store the selected number
        this.selectedNumber = number;
    }

    submitNumber() {
        if (typeof this.selectedNumber === 'undefined') {
            alert('Please select a number');
            return;
        }

        if (!this.gameId || !this.playerId) {
            console.error('Game ID or Player ID is missing');
            return;
        }

        fetch('/submit-number', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                gameId: this.gameId,
                playerId: this.playerId,
                number: this.selectedNumber
            })
        })
        .then(response => response.json())
        .then(data => {
            console.log('Number submission response:', data);
            // Show waiting message
            const numberInput = document.querySelector('.number-input');
            if (numberInput) {
                numberInput.innerHTML = `
                    <div class="waiting-message">
                        Waiting for other players...
                    </div>
                `;
            }
        })
        .catch(error => {
            console.error('Error submitting number:', error);
            alert('Failed to submit number. Please try again.');
        });
    }

    calculateRoundResults() {
        const numbers = Object.values(this.playerNumbers);
        const average = numbers.reduce((a, b) => a + b, 0) / numbers.length;
        const target = average * 0.8;

        // Calculate distances from target
        const results = this.players
            .filter(p => p.isAlive)
            .map(player => ({
                player,
                number: this.playerNumbers[player.index],
                distance: Math.abs(this.playerNumbers[player.index] - target)
            }));

        // Sort by distance
        results.sort((a, b) => a.distance - b.distance);

        // Apply rules and update points
        this.applyRoundRules(results, target);

        // Clear numbers for next round
        this.playerNumbers = {};
        
        // Show results for 10 seconds before starting next round
        this.showResultsCountdown(10, () => {
            this.currentRound++;
            this.startRound();
        });
    }

    showResultsCountdown(seconds, callback) {
        const countdownDiv = document.createElement('div');
        countdownDiv.className = 'results-countdown';
        countdownDiv.textContent = `Next round in ${seconds}s`;
        document.querySelector('.game-info').appendChild(countdownDiv);

        const interval = setInterval(() => {
            seconds--;
            if (seconds <= 0) {
                clearInterval(interval);
                countdownDiv.remove();
                callback();
            } else {
                countdownDiv.textContent = `Next round in ${seconds}s`;
            }
        }, 1000);
    }

    applyRoundRules(results, target) {
        const alivePlayers = this.players.filter(p => p.isAlive).length;
        
        // Check if there's only one player alive at the start
        if (alivePlayers === 1) {
            this.showFinalResults(this.players.find(p => p.isAlive));
            return;
        }

        const numbers = Object.values(this.playerNumbers);
        
        // Check for special rules based on player count
        if (alivePlayers === 2) {
            // Rule: If someone chooses 0, player with 100 wins
            const hasZero = numbers.includes(0);
            const has100 = numbers.includes(100);
            if (hasZero && has100) {
                const winner100 = results.find(r => r.number === 100);
                results = results.map(r => ({
                    ...r,
                    isWinner: r.number === 100
                }));
                results.forEach(result => {
                    if (!result.isWinner) {
                        result.player.points--;
                    }
                });
                return;
            }
        }
        
        // Check for duplicate numbers (applies when 4 or 3 players remain)
        if (alivePlayers <= 4) {
            const numberCounts = {};
            numbers.forEach(num => {
                numberCounts[num] = (numberCounts[num] || 0) + 1;
            });
            
            // Mark players with duplicate numbers as invalid
            results.forEach(result => {
                if (numberCounts[result.number] >= 2) {
                    result.invalid = true;
                }
            });
        }
        
        // Check for exact match when 3 players remain
        const hasExactMatch = alivePlayers === 3 && results.some(r => r.distance === 0);
        
        // Apply standard rules and penalties
        const winner = results[0];
        results.slice(1).forEach(result => {
            // Apply penalties
            if (result.invalid) {
                result.player.points--; // Lose point for invalid number
            } else if (hasExactMatch) {
                result.player.points -= 2; // Double penalty when exact match exists
            } else {
                result.player.points--; // Standard penalty
            }
            
            if (result.player.points <= -10) {
                result.player.isAlive = false;
                this.playSound('elimination');
            }
        });

        this.updatePlayersGrid();
        this.showRoundResults(results, target, hasExactMatch);

        // Check if there's only one player alive after applying penalties
        const remainingPlayers = this.players.filter(p => p.isAlive);
        if (remainingPlayers.length === 1) {
            this.showFinalResults(remainingPlayers[0]);
            return;
        }
    }

    showRoundResults(results, target, hasExactMatch) {
        // Clear previous results
        const previousResults = document.querySelectorAll('.round-results, .results-countdown');
        previousResults.forEach(el => el.remove());

        const numbers = Object.values(this.playerNumbers);
        const average = numbers.reduce((a, b) => a + b, 0) / numbers.length;

        // Find all winners (players with the same minimum distance)
        const minDistance = results[0].distance;
        const winners = results.filter(r => Math.abs(r.distance - minDistance) < 0.0001);

        // Store round data in history
        this.roundHistory.push({
            roundNumber: this.currentRound,
            results: results,
            average: average,
            target: target,
            hasExactMatch: hasExactMatch,
            winners: winners
        });

        const resultsHTML = results.map(r => 
            `<div class="player-result ${winners.includes(r) ? 'winner' : ''} ${r.invalid ? 'invalid' : ''}">
                ${winners.includes(r) ? '👑 ' : ''}${r.player.name}: ${r.number} 
                (distance: ${r.distance.toFixed(2)})
                ${r.invalid ? ' ❌ Invalid (duplicate number)' : ''}
                ${winners.includes(r) ? ' - Round Winner!' : ''}
            </div>`
        ).join('');

        const resultsDiv = document.createElement('div');
        resultsDiv.className = 'round-results';
        resultsDiv.innerHTML = `
            <h3>Round ${this.currentRound} Results</h3>
            <div class="average-display">
                <p>Team Average: ${average.toFixed(2)}</p>
                <p>Target (0.8 × average): ${target.toFixed(2)}</p>
                <p class="winner-info">Round ${winners.length > 1 ? 'Winners' : 'Winner'}: 
                    ${winners.map(w => `${w.player.name} (${w.number})`).join(', ')}</p>
                ${hasExactMatch ? '<p class="penalty-notice">⚠️ Exact match found! Double penalty for losers</p>' : ''}
            </div>
            <div class="player-results">
                ${resultsHTML}
            </div>
            <button class="history-btn" onclick="window.game.showHistory()">View Round History</button>
        `;

        document.querySelector('.game-info').appendChild(resultsDiv);

        // Play a small sound effect for human winners
        if (winners.some(w => !w.player.isBot)) {
            this.playSound('submit');
        }
    }

    endRound() {
        // Clear the timer
        clearInterval(this.timer);
        
        // If player hasn't selected a number, automatically select one
        if (typeof this.selectedNumber === 'undefined' && this.gameId && this.playerId) {
            // Generate random number between 0 and 100
            const randomNumber = Math.floor(Math.random() * 101);
            console.log('Auto-selecting number:', randomNumber);

            // Show auto-selection message immediately
            const numberInput = document.querySelector('.number-input');
            if (numberInput) {
                numberInput.innerHTML = `
                    <div class="auto-selection-message">
                        Time's up! Number ${randomNumber} was automatically selected.
                        <br>
                        Waiting for other players...
                    </div>
                `;
            }

            // Submit the random number
            fetch('/submit-number', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    gameId: this.gameId,
                    playerId: this.playerId,
                    number: randomNumber,
                    isAutoSelected: true
                })
            })
            .then(response => response.json())
            .then(data => {
                console.log('Auto-submission response:', data);
            })
            .catch(error => {
                console.error('Error in auto-submission:', error);
            });
        }
    }

    addBot(index) {
        // Don't allow adding bot if spot is taken
        if (this.players.some(p => p.index === index)) {
            alert('This spot is already taken!');
            return;
        }

        this.playSound('buttonClick');
        const botName = `Bot ${index + 1}`;
        
        fetch('/join', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                playerName: botName,
                spotIndex: index,
                isBot: true
            })
        })
        .then(response => response.json())
        .then(data => {
            console.log('Bot join response:', data);
            // Bot joining is handled through waiting room update
        })
        .catch(error => {
            console.error('Error adding bot:', error);
            alert('Failed to add bot. Please try again.');
        });
    }

    showFinalResults(winner) {
        // Clear any existing timers
        clearInterval(this.timer);
        
        const resultsDiv = document.createElement('div');
        resultsDiv.className = 'final-round-results';
        resultsDiv.innerHTML = `
            <h2>🏆 Final Round Results 🏆</h2>
            <div class="final-results-content">
                <div class="round-results">
                    ${document.querySelector('.round-results').innerHTML}
                </div>
                <div class="winner-announcement">
                    <h3>${winner.name} is the Winner!</h3>
                    <p>Congratulations on surviving the Death Game!</p>
                    <button id="return-lobby" class="return-btn">Return to Lobby</button>
                </div>
            </div>
        `;

        // Clear the game screen and show final results
        const gameInfo = document.querySelector('.game-info');
        gameInfo.innerHTML = '';
        gameInfo.appendChild(resultsDiv);

        // Stop background music and play winner sound
        this.sounds.bgMusic.pause();
        this.sounds.bgMusic.currentTime = 0;
        this.playSound('winner');

        document.getElementById('return-lobby').addEventListener('click', () => {
            this.resetGame();
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
        clearInterval(this.timer);

        // Reset UI
        document.getElementById('game-screen').classList.remove('active');
        document.getElementById('login-screen').classList.add('active');
        
        // Clear all game screens
        document.querySelector('.game-info').innerHTML = `
            <h2>Round <span id="round-number">1</span></h2>
            <div id="timer">Time remaining: <span id="time">60</span>s</div>
            <div id="current-rules"></div>
        `;
        document.querySelector('.players-grid').innerHTML = '';
        document.querySelector('.number-input').innerHTML = '';

        // Clear any remaining results or countdowns
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

        this.roundHistory = []; // Clear round history
        this.gameStarted = false;
        this.currentPlayer = null;
    }

    showHistory() {
        const historyModal = document.createElement('div');
        historyModal.className = 'history-modal';
        
        const historyContent = document.createElement('div');
        historyContent.className = 'history-content';
        
        // Create round tabs
        const tabsContainer = document.createElement('div');
        tabsContainer.className = 'history-tabs';
        this.roundHistory.forEach((round, index) => {
            const tab = document.createElement('button');
            tab.className = 'history-tab';
            tab.textContent = `Round ${round.roundNumber}`;
            tab.onclick = () => this.showRoundDetails(round, index);
            tabsContainer.appendChild(tab);
        });
        
        const closeBtn = document.createElement('button');
        closeBtn.className = 'close-history';
        closeBtn.innerHTML = '&times;';
        closeBtn.onclick = () => historyModal.remove();
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'round-details';
        
        historyContent.appendChild(closeBtn);
        historyContent.appendChild(tabsContainer);
        historyContent.appendChild(contentDiv);
        historyModal.appendChild(historyContent);
        document.body.appendChild(historyModal);
        
        // Show the last round by default
        if (this.roundHistory.length > 0) {
            this.showRoundDetails(this.roundHistory[this.roundHistory.length - 1], this.roundHistory.length - 1);
        }
    }

    showRoundDetails(round, tabIndex) {
        // Update active tab
        const tabs = document.querySelectorAll('.history-tab');
        tabs.forEach((tab, i) => {
            tab.classList.toggle('active', i === tabIndex);
        });

        const contentDiv = document.querySelector('.round-details');
        const resultsHTML = round.results.map(r => 
            `<div class="player-result ${round.winners.includes(r) ? 'winner' : ''} ${r.invalid ? 'invalid' : ''}">
                ${round.winners.includes(r) ? '👑 ' : ''}${r.player.name}: ${r.number} 
                (distance: ${r.distance.toFixed(2)})
                ${r.invalid ? ' ❌ Invalid (duplicate number)' : ''}
                ${round.winners.includes(r) ? ' - Round Winner!' : ''}
            </div>`
        ).join('');

        contentDiv.innerHTML = `
            <div class="history-round-info">
                <h3>Round ${round.roundNumber}</h3>
                <div class="average-display">
                    <p>Team Average: ${round.average.toFixed(2)}</p>
                    <p>Target (0.8 × average): ${round.target.toFixed(2)}</p>
                    <p class="winner-info">Round ${round.winners.length > 1 ? 'Winners' : 'Winner'}: 
                        ${round.winners.map(w => `${w.player.name} (${w.number})`).join(', ')}</p>
                </div>
                <div class="player-results">
                    ${resultsHTML}
                </div>
            </div>
        `;
    }

    removePlayerFromSpot(index) {
        // Remove player from players array
        this.players = this.players.filter(p => p.index !== index);
        
        // Reset the join button
        const joinBtn = document.querySelectorAll('.join-btn')[index];
        joinBtn.innerHTML = `Join Spot ${index + 1}`;
        joinBtn.classList.remove('occupied');
        
        // Show the bot button again
        const botBtn = document.querySelectorAll('.bot-btn')[index];
        botBtn.style.display = 'block';
        
        // Enable all join buttons
        document.querySelectorAll('.join-btn').forEach(btn => {
            btn.classList.remove('other-player');
        });
        
        // Update player count
        document.getElementById('players-ready').textContent = this.players.length;
        document.getElementById('start-game').disabled = this.players.length !== this.maxPlayers;
        
        this.currentPlayer = null;
    }

    setupPusher() {
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
            // Update UI to show bot submission
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

    handleGameStart(data) {
        console.log('Handling game start with data:', data);
        if (!this.playerId) {
            console.error('Cannot start game: missing playerId');
            return;
        }

        this.gameId = data.gameId;
        
        // Update players array with server data to ensure sync
        this.players = data.players.map(player => ({
            id: player.id,
            name: player.name,
            index: player.spotIndex,
            points: 0,
            isAlive: true,
            isBot: false
        }));
        
        // Find current player in the players array
        const currentPlayer = this.players.find(p => p.id === this.playerId);
        if (currentPlayer) {
            this.currentPlayer = currentPlayer.index;
            this.gameStarted = true;
            this.startGame();
        } else {
            console.error('Current player not found in game data:', {
                playerId: this.playerId,
                players: this.players
            });
        }
    }

    handleRoundResult(data) {
        const { results, target, hasExactMatch } = data;
        this.showRoundResults(results, target, hasExactMatch);
    }

    updateWaitingRoom(players) {
        console.log('Updating waiting room with players:', players);
        // Update UI to show waiting players
        const slots = document.querySelectorAll('.join-btn');
        slots.forEach((slot, index) => {
            const player = players.find(p => p.spotIndex === index);
            if (player) {
                // Show player in slot with leave button if it's the current player
                const isCurrentPlayer = player.id === this.playerId;
                slot.innerHTML = `
                    <span class="status-icon">${player.isBot ? '🤖' : '👤'}</span>
                    <span class="player-name">${player.name}</span>
                    <span class="spot-number">#${index + 1}</span>
                    ${isCurrentPlayer ? '<button class="leave-btn" onclick="window.game.leaveGame()">Leave</button>' : ''}
                `;
                slot.classList.add('occupied');
                
                // Hide bot button for occupied slots
                const botBtn = document.querySelectorAll('.bot-btn')[index];
                if (botBtn) {
                    botBtn.style.display = 'none';
                }
            } else {
                // Reset empty slots
                slot.innerHTML = `Join Spot ${index + 1}`;
                slot.classList.remove('occupied');
                
                // Show bot button for empty slots
                const botBtn = document.querySelectorAll('.bot-btn')[index];
                if (botBtn) {
                    botBtn.style.display = 'block';
                }
            }
        });

        // Update player count and start button
        const playerCount = players.length;
        const playersReadyElement = document.getElementById('players-ready');
        const startButton = document.getElementById('start-game');
        
        if (playersReadyElement) {
            playersReadyElement.textContent = playerCount;
        }
        
        if (startButton && !this.gameStarted) {
            startButton.disabled = playerCount !== this.maxPlayers;
            startButton.textContent = playerCount === this.maxPlayers ? 'Game Starting...' : 'Start Game';
        }
    }

    leaveGame() {
        if (this.gameStarted) {
            alert('Cannot leave during an active game!');
            return;
        }

        if (this.currentPlayer === null) {
            return;
        }

        fetch('/leave', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
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
}

// Initialize game when page loads
document.addEventListener('DOMContentLoaded', () => {
    window.game = new DeathGame();
}); 