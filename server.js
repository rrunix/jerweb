const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = 5001;

// Import game modules
const CSMAGame = require('./games/csma/csma-game');

// Game registry
const games = {
    'csma': {
        name: 'CSMA Game',
        description: 'Carrier Sense Multiple Access - Learn network collision detection',
        module: CSMAGame,
        static: path.join(__dirname, 'games/csma/public')
    },

    'router': {
        name: 'Router Game',
        description: 'Simulate routing protocols and understand how data finds its way',
        static: path.join(__dirname, 'games/router/public')
    },

    'cidr': {
        name: 'CIDR and longest prefix matching Example',
        description: 'Visualization of CIDR and longest prefix matching ',
        static: path.join(__dirname, 'games/cidr/public')
    }

    // Add more games here:
    // 'othergame': {
    //     name: 'Other Game',
    //     description: 'Another educational mini-game',
    //     module: require('./games/othergame/othergame-module'),
    //     static: path.join(__dirname, 'games/othergame/public')
    // }
};

// Serve shared static files
app.use('/shared', express.static(path.join(__dirname, 'shared')));

// Serve static files for each game
Object.keys(games).forEach(gameKey => {
    app.use(`/${gameKey}`, express.static(games[gameKey].static));
});

// Landing page route
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Educational Mini-Games and Visualizations</title>
        <link rel="stylesheet" href="/shared/styles.css">
        <style>
            .games-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
                gap: 20px;
                margin-top: 30px;
            }
            .game-card {
                background: rgba(255, 255, 255, 0.2);
                border-radius: 15px;
                padding: 25px;
                text-align: center;
                transition: all 0.3s ease;
                cursor: pointer;
                text-decoration: none;
                color: white;
                display: block;
            }
            .game-card:hover {
                transform: translateY(-5px);
                background: rgba(255, 255, 255, 0.3);
            }
            .game-title {
                font-size: 1.5em;
                margin-bottom: 15px;
                font-weight: bold;
            }
            .game-description {
                font-size: 1em;
                opacity: 0.9;
                line-height: 1.4;
            }
        </style>
    </head>
    <body class="game-body modern-dark font-modern bg-gradient-purple">
        <div class="game-container glassmorphism" style="max-width: 800px;">
            <h1 class="game-title">🎮 Educational Mini-Games</h1>
            <p style="text-align: center; font-size: 1.1em; opacity: 0.9;">
                Choose a game or visualization to learn about networking and computer science concepts!
            </p>
            <div class="games-grid">
                ${Object.keys(games).map(gameKey => `
                    <a href="/${gameKey}" class="game-card">
                        <div class="game-title" style="font-size: 1.5em; margin-bottom: 10px;">${games[gameKey].name}</div>
                        <div class="game-description">${games[gameKey].description}</div>
                    </a>
                `).join('')}
            </div>
        </div>
    </body>
    </html>
    `);
});

// Game-specific routes
Object.keys(games).forEach(gameKey => {
    app.get(`/${gameKey}`, (req, res) => {
        res.sendFile(path.join(games[gameKey].static, 'index.html'));
    });
});

// Socket.IO connection handling with namespace support
Object.keys(games).forEach(gameKey => {
    const gameNamespace = io.of(`/${gameKey}`);
    if (!games[gameKey] || games[gameKey].module) {
        const GameModule = games[gameKey].module;
        // Initialize game-specific handler
        GameModule.initializeSocket(gameNamespace);
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Multi-game server running on http://localhost:${PORT}`);
    console.log('Available games:');
    Object.keys(games).forEach(gameKey => {
        console.log(`  - ${games[gameKey].name}: http://localhost:${PORT}/${gameKey}`);
    });
});