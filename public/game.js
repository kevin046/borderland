class Game {
    constructor() {
        this.gameId = null;
        this.roundNumber = 1;
        this.selectedNumber = null;
    }

    handleGameStart(data) {
        this.hideAllScreens();
        document.getElementById('game-screen').style.display = 'block';
        
        // Create game layout
        const gameScreen = document.getElementById('game-screen');
        gameScreen.innerHTML = `
            <div class="game-layout">
                <div class="rules-section">
                    <h3>Game Rules</h3>
                    <div class="rules-list">
                        <div class="rule-item">
                            <span class="rule-icon">🎯</span>
                            <span class="rule-text">Select a number between 0 and 100</span>
                        </div>
                        <div class="rule-item">
                            <span class="rule-icon">🎲</span>
                            <span class="rule-text">Target = Average × 0.8 (4/5ths)</span>
                        </div>
                        <div class="rule-item">
                            <span class="rule-icon">👑</span>
                            <span class="rule-text">Player closest to target wins the round</span>
                        </div>
                        <div class="rule-item">
                            <span class="rule-icon">⚠️</span>
                            <span class="rule-text">All losers lose 1 point</span>
                        </div>
                        <div class="rule-item">
                            <span class="rule-icon">💀</span>
                            <span class="rule-text">Game Over: Reach -10 points</span>
                        </div>
                        <div class="rule-item">
                            <span class="rule-icon">⏱️</span>
                            <span class="rule-text">Time Limit: 30 seconds per round</span>
                        </div>
                    </div>
                </div>
                <div class="game-content">
                    <div class="game-results-container">
                        <div class="round-header">
                            <h2>Round <span id="round-number">1</span></h2>
                            <div class="round-numbers">
                                <div class="stat-box">
                                    <div class="stat-label">Average</div>
                                    <div class="stat-value" id="round-average">-</div>
                                </div>
                                <div class="stat-box highlight">
                                    <div class="stat-label">Target</div>
                                    <div class="stat-value" id="round-target">-</div>
                                </div>
                            </div>
                        </div>
                        <div class="players-grid" id="players-grid"></div>
                    </div>
                    <div class="game-board">
                        <div class="number-grid" id="number-grid"></div>
                        <button id="submit-number" class="submit-btn" disabled>Submit Number</button>
                    </div>
                    <div class="status-message" id="status-message">Choose your number for the next round...</div>
                </div>
            </div>
            <div class="chat-box">
                <div class="chat-header">
                    <h3>Chat Room</h3>
                    <button class="minimize-btn">−</button>
                </div>
                <div class="chat-messages" id="chat-messages"></div>
                <div class="chat-input-area">
                    <input type="text" id="chat-input" placeholder="Type your message..." maxlength="100">
                    <button id="send-message">Send</button>
                </div>
            </div>
        `;

        // Generate number buttons
        const numberGrid = document.getElementById('number-grid');
        for (let i = 0; i <= 100; i++) {
            const button = document.createElement('button');
            button.className = 'number-btn';
            button.textContent = i;
            button.onclick = () => {
                document.querySelectorAll('.number-btn').forEach(btn => btn.classList.remove('selected'));
                button.classList.add('selected');
                document.getElementById('submit-number').disabled = false;
                this.selectedNumber = i;
            };
            numberGrid.appendChild(button);
        }

        // Initialize chat minimize functionality
        document.querySelector('.minimize-btn').onclick = () => {
            const chatBox = document.querySelector('.chat-box');
            chatBox.classList.toggle('minimized');
            document.querySelector('.minimize-btn').textContent = chatBox.classList.contains('minimized') ? '+' : '−';
        };

        // Initialize game state
        this.gameId = data.gameId;
        this.roundNumber = 1;
        document.getElementById('round-number').textContent = this.roundNumber;
        this.updatePlayerCards(data.players);
    }

    updatePlayerCards(players) {
        const playersGrid = document.getElementById('players-grid');
        playersGrid.innerHTML = '';

        players.forEach(player => {
            const isEliminated = player.points <= -10;
            const isWinner = player.isWinner;
            
            const card = document.createElement('div');
            card.className = `player-card ${isEliminated ? 'eliminated' : ''} ${isWinner ? 'winner' : ''}`;
            
            card.innerHTML = `
                <div class="player-header">
                    <span class="player-icon">${player.isBot ? '🤖' : '👤'}</span>
                    <span class="player-name">${player.name}</span>
                </div>
                <div class="player-stats">
                    <div class="player-points">
                        <span class="points-label">Points:</span>
                        <span class="points-value ${player.points >= 0 ? 'positive' : 'negative'}">${player.points}</span>
                    </div>
                    <div class="player-status ${isEliminated ? 'eliminated' : ''} ${isWinner ? 'winner' : ''}">${
                        isEliminated ? 'Eliminated' : (isWinner ? 'Winner!' : 'Ready')
                    }</div>
                </div>
                ${player.lastNumber !== undefined ? `
                    <div class="round-details">
                        <div class="round-detail-item">
                            <span class="detail-label">Number:</span>
                            <span class="detail-value">${player.lastNumber}</span>
                        </div>
                        <div class="round-detail-item">
                            <span class="detail-label">Distance:</span>
                            <span class="detail-value">${player.distance?.toFixed(2) || '-'}</span>
                        </div>
                        <div class="round-detail-item">
                            <span class="detail-label">Result:</span>
                            <span class="detail-value ${isWinner ? 'winner' : 'negative'}">${
                                isEliminated ? 'Eliminated!' : (isWinner ? 'Winner!' : '-1 point')
                            }</span>
                        </div>
                    </div>
                ` : ''}
            `;
            
            playersGrid.appendChild(card);
        });
    }

    handleRoundResult(data) {
        const { average, target, players, roundNumber: newRoundNumber } = data;
        
        // Update round information
        document.getElementById('round-number').textContent = newRoundNumber;
        document.getElementById('round-average').textContent = average.toFixed(2);
        document.getElementById('round-target').textContent = target.toFixed(2);
        
        // Update player cards with results
        this.updatePlayerCards(players);
        
        // Reset number selection
        document.querySelectorAll('.number-btn').forEach(btn => btn.classList.remove('selected'));
        document.getElementById('submit-number').disabled = true;
        this.selectedNumber = null;
        
        // Update status message
        const statusMessage = document.getElementById('status-message');
        statusMessage.textContent = 'Round complete! Get ready for the next round...';
        setTimeout(() => {
            statusMessage.textContent = 'Choose your number for the next round...';
        }, 3000);
    }

    hideAllScreens() {
        document.querySelectorAll('.screen').forEach(screen => {
            screen.style.display = 'none';
        });
    }
}

// Initialize the game
const game = new Game();

// Export the game instance
window.game = game; 