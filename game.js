class DeathGame {
    constructor() {
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
            startButton.addEventListener('click', () => this.startGame());
        }

        const joinButtons = document.querySelectorAll('.join-btn');
        joinButtons.forEach((btn, index) => {
            btn.addEventListener('click', () => this.showNameModal(index));
        });

        const botButtons = document.querySelectorAll('.bot-btn');
        botButtons.forEach((btn, index) => {
            btn.addEventListener('click', () => this.addBot(index));
        });

        // Audio controls
        const volumeSlider = document.getElementById('volume');
        const toggleMusic = document.getElementById('toggleMusic');

        if (volumeSlider) {
            volumeSlider.addEventListener('input', (e) => {
                const volume = e.target.value / 100;
                Object.values(this.sounds).forEach(sound => {
                    sound.volume = volume;
                });
            });
        }

        if (toggleMusic) {
            toggleMusic.addEventListener('click', () => {
                if (this.sounds.bgMusic.paused) {
                    this.sounds.bgMusic.play();
                    toggleMusic.textContent = '🔊';
                } else {
                    this.sounds.bgMusic.pause();
                    toggleMusic.textContent = '🔈';
                }
            });
        }

        // Name modal buttons
        document.getElementById('confirm-name').addEventListener('click', () => this.confirmJoin());
        document.getElementById('cancel-join').addEventListener('click', () => this.hideNameModal());
    }

    showNameModal(spotIndex) {
        // Don't allow changing spots after game starts
        if (this.gameStarted) {
            return;
        }

        // If spot is taken by a bot, remove it
        const existingBot = this.players.find(p => p.index === spotIndex && p.isBot);
        if (existingBot) {
            this.removePlayerFromSpot(spotIndex);
        }

        // If player already has a name, move them directly
        if (this.currentPlayer !== null) {
            const player = this.players.find(p => p.index === this.currentPlayer);
            if (player && !this.players.some(p => p.index === spotIndex)) {
                const playerName = player.name;
                this.removePlayerFromSpot(this.currentPlayer);
                this.addPlayer(spotIndex, playerName);
                return;
            }
        }

        if (this.players.some(p => p.index === spotIndex)) {
            alert('This spot is already taken!');
            return;
        }

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
            this.addPlayer(this.selectedSpot, name);
            this.hideNameModal();
        }
    }

    addPlayer(index, name) {
        this.players.push({
            index,
            name,
            points: 0,
            isAlive: true,
            isBot: false
        });

        // Set current player
        this.currentPlayer = index;

        // Update UI
        const joinBtn = document.querySelectorAll('.join-btn')[index];
        joinBtn.innerHTML = `
            <span class="status-icon">👤</span>
            <span class="player-name">${name}</span>
            <span class="spot-number">#${index + 1}</span>
        `;
        joinBtn.classList.add('occupied');

        // Disable other join buttons for this player
        document.querySelectorAll('.join-btn').forEach((btn, i) => {
            if (i !== index && !this.players.some(p => p.index === i)) {
                btn.classList.add('other-player');
            }
        });
        
        // Update player count
        document.getElementById('players-ready').textContent = this.players.length;
        document.getElementById('start-game').disabled = this.players.length !== this.maxPlayers;
    }

    startGame() {
        this.gameStarted = true;
        // Start background music with error handling
        const playPromise = this.sounds.bgMusic.play();
        
        if (playPromise !== undefined) {
            playPromise.catch(error => {
                console.error('Error playing background music:', error);
            });
        }

        document.getElementById('login-screen').classList.remove('active');
        document.getElementById('game-screen').classList.add('active');
        this.updatePlayersGrid();
        this.startRound();
    }

    startRound() {
        // Reset input state and create number table
        this.createNumberTable();
        document.getElementById('submit-number').disabled = true;

        // Set time limit based on round type
        const alivePlayers = this.players.filter(p => p.isAlive).length;
        const isNewRuleRound = this.currentRound === 1 || 
            alivePlayers === 4 || alivePlayers === 3 || alivePlayers === 2;
        this.remainingTime = isNewRuleRound ? 60 : 30;

        // Update the time display immediately
        document.getElementById('time').textContent = this.remainingTime;

        this.updateTimer();
        this.timer = setInterval(() => this.updateTimer(), 1000);
        this.updateRules();

        // Update round number display
        document.getElementById('round-number').textContent = this.currentRound;
    }

    updateTimer() {
        this.remainingTime--;
        document.getElementById('time').textContent = this.remainingTime;
        
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
        // Only show number table to human players who are alive
        const humanPlayer = this.players.find(p => !p.isBot && p.isAlive);
        if (!humanPlayer) {
            return; // Don't show number table if no human player or player is eliminated
        }

        const numberInput = document.querySelector('.number-input');
        numberInput.innerHTML = `
            <div class="number-table">
                <div class="table-header">
                    <div class="table-title">${humanPlayer.name}, select your number (0-100)</div>
                    <button id="submit-number" disabled>Submit</button>
                </div>
                <div class="number-grid"></div>
            </div>
        `;

        const numberGrid = numberInput.querySelector('.number-grid');
        
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
        this.playSound('buttonClick');
        // Remove previous selection
        const previousSelected = document.querySelector('.number-cell.selected');
        if (previousSelected) {
            previousSelected.classList.remove('selected');
        }

        // Add new selection
        cell.classList.add('selected');
        
        // Enable submit button
        document.getElementById('submit-number').disabled = false;
        
        // Store the selected number
        this.selectedNumber = number;
    }

    submitNumber() {
        if (typeof this.selectedNumber === 'undefined') {
            alert('Please select a number');
            return;
        }

        // Find the current human player
        const humanPlayer = this.players.find(p => !p.isBot && p.isAlive);
        if (humanPlayer) {
            this.playerNumbers[humanPlayer.index] = this.selectedNumber;
            // Replace the entire number input area with waiting message
            const numberInput = document.querySelector('.number-input');
            if (numberInput) {
                numberInput.innerHTML = `
                    <div class="waiting-message">
                        Waiting for other players...
                    </div>
                `;
            }
        }

        // Generate bot numbers
        const alivePlayers = this.players.filter(p => p.isAlive).length;
        this.players.forEach(player => {
            if (player.isBot && player.isAlive && !this.playerNumbers[player.index]) {
                this.playerNumbers[player.index] = this.calculateBotNumber(alivePlayers);
            }
        });

        // Since bots submit immediately after human player, we can calculate results right away
        clearInterval(this.timer);
        this.calculateRoundResults();
    }

    calculateBotNumber(alivePlayers) {
        // Helper function to clamp number between 0 and 100
        const clamp = (num) => Math.min(100, Math.max(0, Math.floor(num)));

        // Get previous round numbers if available
        const previousNumbers = Object.values(this.playerNumbers);
        const lastAverage = previousNumbers.length > 0 
            ? previousNumbers.reduce((a, b) => a + b, 0) / previousNumbers.length 
            : null;

        // Different strategies based on number of players
        if (alivePlayers === 2) {
            // In 2-player mode, be more strategic
            if (Math.random() < 0.7) { // 70% chance to play optimally
                return 100; // Usually better to choose 100 in case opponent picks 0
            } else {
                return clamp(Math.floor(Math.random() * 101)); // Sometimes be unpredictable
            }
        }

        if (alivePlayers === 3) {
            // With 3 players, try to hit exact target if we can predict it
            if (lastAverage) {
                // Aim for 0.8 * expected average
                const expectedAverage = lastAverage * 0.9; // Slightly adjust for human behavior
                return clamp(Math.floor(expectedAverage * 0.8));
            }
            // Otherwise play conservatively
            return clamp(Math.floor(Math.random() * 21) + 35); // 35-55 range
        }

        if (alivePlayers <= 4) {
            // Avoid duplicate numbers with other bots
            const usedNumbers = Object.values(this.playerNumbers);
            let botNumber;
            do {
                // Choose from strategic ranges
                const ranges = [
                    [35, 45], // Low range
                    [45, 55], // Mid range
                    [55, 65]  // High range
                ];
                const selectedRange = ranges[Math.floor(Math.random() * ranges.length)];
                botNumber = clamp(Math.floor(Math.random() * (selectedRange[1] - selectedRange[0])) + selectedRange[0]);
            } while (usedNumbers.includes(botNumber));
            return botNumber;
        }

        // For 5 players or initial rounds
        if (lastAverage) {
            // Use previous round data to make an educated guess
            const expectedAverage = lastAverage * 0.95; // Expect slightly lower numbers
            const target = expectedAverage * 0.8;
            // Add some randomness around the target
            return clamp(Math.floor(target + (Math.random() * 10 - 5)));
        }

        // Default strategy for first round or fallback
        const baseNumber = 45; // Strategic base number
        const variance = 15; // Random variance
        return clamp(Math.floor(baseNumber + (Math.random() * variance)));
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
        // Implementation for round end logic
        // This would need to be expanded based on the specific game rules
    }

    addBot(index) {
        // Don't allow adding bot to current player's spot
        if (index === this.currentPlayer) {
            return;
        }

        this.playSound('buttonClick');
        const botBtn = document.querySelectorAll('.bot-btn')[index];
        const joinBtn = document.querySelectorAll('.join-btn')[index];

        // Generate bot name
        const botName = `Bot ${index + 1}`;
        
        // Add bot to players
        this.players.push({
            index,
            name: botName,
            points: 0,
            isAlive: true,
            isBot: true
        });

        // Update UI
        joinBtn.innerHTML = `
            <span class="status-icon">🤖</span>
            <span class="player-name">${botName}</span>
            <span class="spot-number">#${index + 1}</span>
            <span class="remove-bot" onclick="event.stopPropagation(); window.game.removePlayerFromSpot(${index})">❌</span>
        `;
        joinBtn.classList.add('occupied');
        botBtn.style.display = 'none';
        
        document.getElementById('players-ready').textContent = this.players.length;
        document.getElementById('start-game').disabled = this.players.length !== this.maxPlayers;
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
}

// Initialize game when page loads
document.addEventListener('DOMContentLoaded', () => {
    window.game = new DeathGame();
}); 