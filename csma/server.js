const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

const PORT = 3000;
const GAME_DURATION = 60000; // 1 minute
const PROPAGATION_DELAY = 2000; // 2 seconds

// Game state
const waitingPlayers = [];
const activeGames = new Map();
const leaderboard = [];

// Serve static files
app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

class Game {
    constructor(player1, player2) {
        this.id = Date.now().toString();
        this.players = {
            [player1.id]: {
                socket: player1.socket,
                username: player1.username,
                packetsSent: 0,
                packetsSuccessful: 0,
                packetsInAir: 0  // Counter instead of boolean
            },
            [player2.id]: {
                socket: player2.socket,
                username: player2.username,
                packetsSent: 0,
                packetsSuccessful: 0,
                packetsInAir: 0  // Counter instead of boolean
            }
        };
        this.startTime = Date.now();
        this.endTime = this.startTime + GAME_DURATION;
    }

    getOpponentId(playerId) {
        const ids = Object.keys(this.players);
        return ids.find(id => id !== playerId);
    }

    sendPacket(playerId) {
        const player = this.players[playerId];
        const opponentId = this.getOpponentId(playerId);
        const opponent = this.players[opponentId];
        
        if (!player || !opponent) return;

        const now = Date.now();
        player.packetsSent++;

        // Check for collision - if opponent has any packets in the air
        const collision = opponent.packetsInAir > 0;

        if (!collision) {
            // Successful transmission
            player.packetsSuccessful++;
            player.packetsInAir++;

            // Notify sender immediately
            player.socket.emit('packetResult', {
                success: true,
                yourPackets: player.packetsSuccessful,
                totalSent: player.packetsSent
            });

            // Notify opponent after propagation delay (carrier sense)
            setTimeout(() => {
                // Remove this packet from the air after propagation delay
                player.packetsInAir--;
                // Send busy signal if there are packets in the air
                opponent.socket.emit('channelBusy', player.packetsInAir > 0);
            }, PROPAGATION_DELAY);
        } else {
            // Collision occurred - packet is lost
            player.socket.emit('packetResult', {
                success: false,
                yourPackets: player.packetsSuccessful,
                totalSent: player.packetsSent,
                collision: true
            });

            // Notify opponent of collision
            opponent.socket.emit('collision', {
                yourPackets: opponent.packetsSuccessful,
                totalSent: opponent.packetsSent
            });
        }

        // Update both players with current score
        const score = this.calculateScore();
        Object.values(this.players).forEach(p => {
            p.socket.emit('scoreUpdate', {
                score: score
            });
        });
    }

    calculateScore() {
        const p1Success = Object.values(this.players)[0].packetsSuccessful;
        const p2Success = Object.values(this.players)[1].packetsSuccessful;
        
        if (p1Success === 0 || p2Success === 0) return 0;
        
        // Harmonic mean
        return Math.round((2 * p1Success * p2Success) / (p1Success + p2Success));
    }

    endGame() {
        const score = this.calculateScore();
        const player1 = Object.values(this.players)[0];
        const player2 = Object.values(this.players)[1];

        // Add to leaderboard
        leaderboard.push({
            team: `${player1.username} & ${player2.username}`,
            score: score,
            player1Packets: player1.packetsSuccessful,
            player2Packets: player2.packetsSuccessful,
            timestamp: Date.now()
        });

        // Sort leaderboard
        leaderboard.sort((a, b) => b.score - a.score);
        
        // Keep only top 10
        if (leaderboard.length > 10) {
            leaderboard.length = 10;
        }

        // Notify players
        Object.values(this.players).forEach(player => {
            player.socket.emit('gameOver', {
                finalScore: score,
                yourPackets: player.packetsSuccessful,
                totalSent: player.packetsSent,
                leaderboard: leaderboard
            });
        });
    }
}

io.on('connection', (socket) => {
    console.log('New connection:', socket.id);

    socket.on('joinGame', (username) => {
        console.log(`${username} wants to join`);

        // Add to waiting queue
        waitingPlayers.push({
            id: socket.id,
            socket: socket,
            username: username
        });

        socket.emit('waiting', { playersInQueue: waitingPlayers.length });

        // Check if we can start a game
        if (waitingPlayers.length >= 2) {
            const player1 = waitingPlayers.shift();
            const player2 = waitingPlayers.shift();

            const game = new Game(player1, player2);
            activeGames.set(game.id, game);

            // Store game ID in socket
            player1.socket.gameId = game.id;
            player2.socket.gameId = game.id;
            player1.socket.playerId = player1.id;
            player2.socket.playerId = player2.id;

            // Notify players
            player1.socket.emit('gameStart', {
                opponent: player2.username,
                duration: GAME_DURATION / 1000
            });

            player2.socket.emit('gameStart', {
                opponent: player1.username,
                duration: GAME_DURATION / 1000
            });

            // Send countdown updates every second
            const countdownInterval = setInterval(() => {
                const now = Date.now();
                const timeLeft = Math.max(0, Math.floor((game.endTime - now) / 1000));
                
                Object.values(game.players).forEach(p => {
                    p.socket.emit('timeUpdate', { timeLeft });
                });

                if (timeLeft <= 0) {
                    clearInterval(countdownInterval);
                }
            }, 1000);

            // Set game timer
            setTimeout(() => {
                clearInterval(countdownInterval);
                game.endGame();
                activeGames.delete(game.id);
            }, GAME_DURATION);
        }
    });

    socket.on('sendPacket', () => {
        const gameId = socket.gameId;
        const playerId = socket.playerId;
        const game = activeGames.get(gameId);

        if (game && Date.now() < game.endTime) {
            game.sendPacket(playerId);
        }
    });

    socket.on('getLeaderboard', () => {
        socket.emit('leaderboard', leaderboard);
    });

    socket.on('disconnect', () => {
        console.log('Disconnected:', socket.id);
        
        // Remove from waiting queue
        const index = waitingPlayers.findIndex(p => p.id === socket.id);
        if (index !== -1) {
            waitingPlayers.splice(index, 1);
        }

        // Handle active game disconnection
        const gameId = socket.gameId;
        const game = activeGames.get(gameId);
        if (game) {
            // Notify other player
            const opponentId = game.getOpponentId(socket.playerId);
            if (game.players[opponentId]) {
                game.players[opponentId].socket.emit('opponentDisconnected');
            }
            activeGames.delete(gameId);
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
});