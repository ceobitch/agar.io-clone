/*jslint bitwise: true, node: true */
'use strict';

const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000,
    upgradeTimeout: 30000,
    allowUpgrades: true,
    perMessageDeflate: false
});
const SAT = require('sat');
const solana = require('./solana');
const path = require('path');
const { PublicKey } = require('@solana/web3.js');

const gameLogic = require('./game-logic');
const loggingRepositry = require('./repositories/logging-repository');
const chatRepository = require('./repositories/chat-repository');
const config = require('../../config');
const util = require('./lib/util');
const mapUtils = require('./map/map');
const {getPosition} = require("./lib/entityUtils");
const gameRules = require('./game-rules');
const { GAME_WALLET_PUBLIC_KEY } = require('./solana');

// Initialize game state
let map = new mapUtils.Map(config);
let sockets = {};
let spectators = [];
const INIT_MASS_LOG = util.mathLog(config.defaultPlayerMass, config.slowBase);
let leaderboard = [];
let leaderboardChanged = false;

const Vector = SAT.Vector;

// Serve static files
app.use(express.static(path.join(__dirname, '../../public')));
app.use(express.static(path.join(__dirname, '../client')));

// Game functions
function generateSpawnpoint() {
    let radius = util.massToRadius(config.defaultPlayerMass);
    return getPosition(config.newPlayerInitialPosition === 'farthest', radius, map.players.data);
}

function tickPlayer(currentPlayer) {
    // Remove inactivity check - players stay in game
    currentPlayer.move(config.slowBase, config.gameWidth, config.gameHeight, INIT_MASS_LOG);

    const isEntityInsideCircle = (point, circle) => {
        return SAT.pointInCircle(new Vector(point.x, point.y), circle);
    };

    const canEatMass = (cell, cellCircle, cellIndex, mass) => {
        if (isEntityInsideCircle(mass, cellCircle)) {
            if (mass.id === currentPlayer.id && mass.speed > 0 && cellIndex === mass.num)
                return false;
            if (cell.mass > mass.mass * 1.1)
                return true;
        }
        return false;
    };

    const canEatVirus = (cell, cellCircle, virus) => {
        return virus.mass < cell.mass && isEntityInsideCircle(virus, cellCircle)
    }

    const cellsToSplit = [];
    for (let cellIndex = 0; cellIndex < currentPlayer.cells.length; cellIndex++) {
        const currentCell = currentPlayer.cells[cellIndex];
        const cellCircle = currentCell.toCircle();

        const eatenFoodIndexes = util.getIndexes(map.food.data, food => isEntityInsideCircle(food, cellCircle));
        const eatenMassIndexes = util.getIndexes(map.massFood.data, mass => canEatMass(currentCell, cellCircle, cellIndex, mass));
        const eatenVirusIndexes = util.getIndexes(map.viruses.data, virus => canEatVirus(currentCell, cellCircle, virus));

        if (eatenVirusIndexes.length > 0) {
            cellsToSplit.push(cellIndex);
            map.viruses.delete(eatenVirusIndexes)
        }

        let massGained = eatenMassIndexes.reduce((acc, index) => acc + map.massFood.data[index].mass, 0);

        map.food.delete(eatenFoodIndexes);
        map.massFood.remove(eatenMassIndexes);
        massGained += (eatenFoodIndexes.length * config.foodMass);
        currentPlayer.changeCellMass(cellIndex, massGained);
    }
    currentPlayer.virusSplit(cellsToSplit, config.limitSplit, config.defaultPlayerMass);
}

// Helper: Check if entry fee is paid (stub, replace with real check)
async function hasPaidEntryFee(walletAddress) {
    // TODO: Implement real check using Solana transaction history or escrow
    // For now, always return true for testing
    return true;
}

function tickGame() {
    map.players.data.forEach(tickPlayer);
    map.massFood.move(config.gameWidth, config.gameHeight);

    map.players.handleCollisions(async function (gotEaten, eater) {
        const cellGotEaten = map.players.getCell(gotEaten.playerIndex, gotEaten.cellIndex);
        const eaterPlayer = map.players.data[eater.playerIndex];
        const eatenPlayer = map.players.data[gotEaten.playerIndex];

        // Update last hit by
        if (eatenPlayer.walletAddress && eaterPlayer.walletAddress) {
            gameRules.updateLastHitBy(eatenPlayer.walletAddress, eaterPlayer.walletAddress);
        }

        // Transfer SOL from eaten to eater
        if (eatenPlayer.walletAddress && eaterPlayer.walletAddress) {
            // Transfer all of eatenPlayer's solBalance to eaterPlayer
            const solTransferred = eatenPlayer.solBalance;
            eaterPlayer.solBalance += solTransferred;
            eatenPlayer.solBalance = 0;
            // Notify both players
            if (sockets[eaterPlayer.id]) sockets[eaterPlayer.id].emit('solBalanceUpdate', { solBalance: eaterPlayer.solBalance });
            if (sockets[eatenPlayer.id]) sockets[eatenPlayer.id].emit('solBalanceUpdate', { solBalance: eatenPlayer.solBalance });
            io.emit('rewardEarned', {
                player: eaterPlayer.name,
                amount: solTransferred,
                fee: 0,
                eatenPlayer: eatenPlayer.name
            });
        }

        eaterPlayer.changeCellMass(eater.cellIndex, cellGotEaten.mass);

        const playerDied = map.players.removeCell(gotEaten.playerIndex, gotEaten.cellIndex);
        if (playerDied) {
            if (eatenPlayer.walletAddress) {
                gameRules.removePlayer(eatenPlayer.walletAddress);
            }
            io.emit('playerDied', { name: eatenPlayer.name });
            sockets[eatenPlayer.id].emit('RIP');
            map.players.removePlayerByIndex(gotEaten.playerIndex);
        }
    });
}

function calculateLeaderboard() {
    const topPlayers = map.players.getTopPlayers();

    // Add wallet address and valuation to each player
    const enrichedPlayers = topPlayers.map(player => ({
        ...player,
        walletAddress: player.walletAddress || '',
        valuation: player.massTotal * gameRules.ENTRY_FEE / config.defaultPlayerMass // Calculate valuation based on mass
    }));

    if (leaderboard.length !== enrichedPlayers.length) {
        leaderboard = enrichedPlayers;
        leaderboardChanged = true;
    } else {
        for (let i = 0; i < leaderboard.length; i++) {
            if (leaderboard[i].id !== enrichedPlayers[i].id) {
                leaderboard = enrichedPlayers;
                leaderboardChanged = true;
                break;
            }
        }
    }
}

function gameloop() {
    if (map.players.data.length > 0) {
        calculateLeaderboard();
        map.players.shrinkCells(config.massLossRate, config.defaultPlayerMass, config.minMassLoss);
    }

    map.balanceMass(config.foodMass, config.gameMass, config.maxFood, config.maxVirus);
}

function sendLeaderboard(socket) {
    socket.emit('leaderboard', {
        players: map.players.data.length,
        leaderboard
    });
}

function updateSpectator(socketID) {
    let playerData = {
        x: config.gameWidth / 2,
        y: config.gameHeight / 2,
        cells: [],
        massTotal: 0,
        hue: 100,
        id: socketID,
        name: ''
    };
    sockets[socketID].emit('serverTellPlayerMove', playerData, map.players.data, map.food.data, map.massFood.data, map.viruses.data);
    if (leaderboardChanged) {
        sendLeaderboard(sockets[socketID]);
    }
}

function sendUpdates() {
    spectators.forEach(updateSpectator);
    map.enumerateWhatPlayersSee(function (playerData, visiblePlayers, visibleFood, visibleMass, visibleViruses) {
        sockets[playerData.id].emit('serverTellPlayerMove', playerData, visiblePlayers, visibleFood, visibleMass, visibleViruses);
        if (leaderboardChanged) {
            sendLeaderboard(sockets[playerData.id]);
        }
    });

    leaderboardChanged = false;
}

// Initialize game loops
setInterval(tickGame, 1000 / 60);
setInterval(gameloop, 1000);
setInterval(sendUpdates, 1000 / config.networkUpdateFactor);

// Socket.io connection handler
io.on('connection', function (socket) {
    let type = socket.handshake.query.type;
    console.log('User has connected: ', type);
    switch (type) {
        case 'player':
            addPlayer(socket);
            break;
        case 'spectator':
            addSpectator(socket);
            break;
        default:
            console.log('Unknown user type, not doing anything.');
    }

    // Cash-out logic (add a new socket event)
    socket.on('cashOut', async function () {
        const player = map.players.data.find(p => p.id === socket.id);
        if (!player || !player.walletAddress) {
            socket.emit('cashOutResult', { success: false, message: 'Player not found or wallet missing.' });
            return;
        }
        const amount = player.solBalance;
        if (amount <= 0) {
            socket.emit('cashOutResult', { success: false, message: 'No SOL to cash out.' });
            return;
        }
        // Send reward via Solana
        const success = await solana.sendReward(player.walletAddress, amount);
        if (success) {
            player.solBalance = 0;
            socket.emit('solBalanceUpdate', { solBalance: 0 });
            socket.emit('cashOutResult', { success: true, message: `Cashed out ${amount} SOL!` });
        } else {
            socket.emit('cashOutResult', { success: false, message: 'Failed to send SOL.' });
        }
    });
});

const addPlayer = (socket) => {
    var currentPlayer = new mapUtils.playerUtils.Player(socket.id);

    socket.on('gotit', async function (clientPlayerData) {
        console.log('[INFO] Player ' + clientPlayerData.name + ' connecting!');
        currentPlayer.init(generateSpawnpoint(), config.defaultPlayerMass);

        if (map.players.findIndexByID(socket.id) > -1) {
            console.log('[INFO] Player ID is already connected, kicking.');
            socket.disconnect();
        } else if (!util.validNick(clientPlayerData.name)) {
            socket.emit('kick', 'Invalid username.');
            socket.disconnect();
        } else {
            // Enforce entry fee payment
            currentPlayer.walletAddress = clientPlayerData.walletAddress;
            console.log('[INFO] Wallet address received:', currentPlayer.walletAddress); // Debug log

            if (!currentPlayer.walletAddress) {
                console.log('[ERROR] No wallet address provided');
                socket.emit('kick', 'Wallet address required.');
                socket.disconnect();
                return;
            }

            // Validate wallet address format
            try {
                new PublicKey(currentPlayer.walletAddress);
            } catch (err) {
                console.log('[ERROR] Invalid wallet address format:', err.message);
                socket.emit('kick', 'Invalid wallet address format.');
                socket.disconnect();
                return;
            }

            const paid = await hasPaidEntryFee(currentPlayer.walletAddress);
            if (!paid) {
                console.log('[ERROR] Entry fee not paid for wallet:', currentPlayer.walletAddress);
                socket.emit('kick', 'Entry fee not paid.');
                socket.disconnect();
                return;
            }

            // Store wallet address and add to active players
            gameRules.addPlayer(currentPlayer.walletAddress);
            console.log('[INFO] Player added with wallet:', currentPlayer.walletAddress);

            const sanitizedName = clientPlayerData.name.replace(/(<([^>]+)>)/ig, '');
            clientPlayerData.name = sanitizedName;
            currentPlayer.clientProvidedData(clientPlayerData);
            map.players.pushNew(currentPlayer);
            sockets[socket.id] = socket;
            io.emit('playerJoin', { name: currentPlayer.name });
            // Send initial solBalance to client
            socket.emit('solBalanceUpdate', { solBalance: currentPlayer.solBalance });
            console.log('Total players: ' + map.players.data.length);
        }
    });

    socket.on('pingcheck', () => {
        socket.emit('pongcheck');
    });

    socket.on('windowResized', (data) => {
        currentPlayer.screenWidth = data.screenWidth;
        currentPlayer.screenHeight = data.screenHeight;
    });

    socket.on('respawn', () => {
        map.players.removePlayerByID(currentPlayer.id);
        socket.emit('welcome', currentPlayer, {
            width: config.gameWidth,
            height: config.gameHeight
        });
        console.log('[INFO] User ' + currentPlayer.name + ' has respawned');
    });

    socket.on('disconnect', () => {
        if (currentPlayer.walletAddress) {
            // Just log the disconnect, don't remove the player
            console.log('[INFO] User ' + currentPlayer.name + ' disconnected but staying in game');
        }
        
        // Don't remove player from map
        console.log('[INFO] User ' + currentPlayer.name + ' has disconnected but remains in game');
        socket.broadcast.emit('playerDisconnect', { name: currentPlayer.name });
    });

    socket.on('playerChat', (data) => {
        var _sender = data.sender.replace(/(<([^>]+)>)/ig, '');
        var _message = data.message.replace(/(<([^>]+)>)/ig, '');

        if (config.logChat === 1) {
            console.log('[CHAT] [' + (new Date()).getHours() + ':' + (new Date()).getMinutes() + '] ' + _sender + ': ' + _message);
        }

        socket.broadcast.emit('serverSendPlayerChat', {
            sender: currentPlayer.name,
            message: _message.substring(0, 35)
        });

        chatRepository.logChatMessage(_sender, _message, currentPlayer.ipAddress)
            .catch((err) => console.error("Error when attempting to log chat message", err));
    });

    socket.on('pass', async (data) => {
        const password = data[0];
        if (password === config.adminPass) {
            console.log('[ADMIN] ' + currentPlayer.name + ' just logged in as an admin.');
            socket.emit('serverMSG', 'Welcome back ' + currentPlayer.name);
            socket.broadcast.emit('serverMSG', currentPlayer.name + ' just logged in as an admin.');
            currentPlayer.admin = true;
        } else {
            console.log('[ADMIN] ' + currentPlayer.name + ' attempted to log in with the incorrect password: ' + password);

            socket.emit('serverMSG', 'Password incorrect, attempt logged.');

            loggingRepositry.logFailedLoginAttempt(currentPlayer.name, currentPlayer.ipAddress)
                .catch((err) => console.error("Error when attempting to log failed login attempt", err));
        }
    });

    socket.on('kick', (data) => {
        if (!currentPlayer.admin) {
            socket.emit('serverMSG', 'You are not permitted to use this command.');
            return;
        }

        var reason = '';
        var worked = false;
        for (let playerIndex in map.players.data) {
            let player = map.players.data[playerIndex];
            if (player.name === data[0] && !player.admin && !worked) {
                if (data.length > 1) {
                    for (var f = 1; f < data.length; f++) {
                        if (f === data.length) {
                            reason = reason + data[f];
                        }
                        else {
                            reason = reason + data[f] + ' ';
                        }
                    }
                }
                if (reason !== '') {
                    console.log('[ADMIN] User ' + player.name + ' kicked successfully by ' + currentPlayer.name + ' for reason ' + reason);
                }
                else {
                    console.log('[ADMIN] User ' + player.name + ' kicked successfully by ' + currentPlayer.name);
                }
                socket.emit('serverMSG', 'User ' + player.name + ' was kicked by ' + currentPlayer.name);
                sockets[player.id].emit('kick', reason);
                sockets[player.id].disconnect();
                map.players.removePlayerByIndex(playerIndex);
                worked = true;
            }
        }
        if (!worked) {
            socket.emit('serverMSG', 'Could not locate user or user is an admin.');
        }
    });

    // Heartbeat function, update everytime.
    socket.on('0', (target) => {
        currentPlayer.lastHeartbeat = new Date().getTime();
        if (target.x !== currentPlayer.x || target.y !== currentPlayer.y) {
            currentPlayer.target = target;
        }
    });

    socket.on('1', function () {
        // Fire food.
        const minCellMass = config.defaultPlayerMass + config.fireFood;
        for (let i = 0; i < currentPlayer.cells.length; i++) {
            if (currentPlayer.cells[i].mass >= minCellMass) {
                currentPlayer.changeCellMass(i, -config.fireFood);
                map.massFood.addNew(currentPlayer, i, config.fireFood);
            }
        }
    });

    socket.on('2', () => {
        currentPlayer.userSplit(config.limitSplit, config.defaultPlayerMass);
    });
}

const addSpectator = (socket) => {
    socket.on('gotit', function () {
        sockets[socket.id] = socket;
        spectators.push(socket.id);
        io.emit('playerJoin', { name: '' });
    });

    socket.emit("welcome", {}, {
        width: config.gameWidth,
        height: config.gameHeight
    });
}

// API endpoints
app.get('/api/game-wallet', (req, res) => {
    if (!GAME_WALLET_PUBLIC_KEY) {
        return res.status(500).json({ error: 'Game wallet not initialized' });
    }
    res.json({ publicKey: GAME_WALLET_PUBLIC_KEY });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
});

// Start server only if not in serverless environment
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
    const ipaddress = process.env.OPENSHIFT_NODEJS_IP || process.env.IP || config.host;
    const serverport = process.env.OPENSHIFT_NODEJS_PORT || process.env.PORT || config.port;
    http.listen(serverport, ipaddress, () => console.log('[DEBUG] Listening on ' + ipaddress + ':' + serverport));
}

// Export for serverless
module.exports = app;
