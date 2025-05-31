var io = require('socket.io-client');
var render = require('./render');
var ChatClient = require('./chat-client');
var Canvas = require('./canvas');
var global = require('./global');

// No external wallet adapter needed; rely on injected window.solana provider

// Solana wallet integration
let socket;

// Abbreviate a Solana public key to e.g. ABCD…WXYZ
function abbreviateAddress(address) {
    if (!address || address.length < 8) return address;
    return address.slice(0, 4) + '…' + address.slice(-4);
}

// Prompt the user to connect their wallet and return the public key (string).
async function connectWallet() {
    try {
        // 1. Use any injected provider (Phantom, Backpack, Solflare, etc.) via the standard API.
        if (window.solana && typeof window.solana.connect === 'function') {
            // Force the popup even if the site was previously connected.
            const resp = await window.solana.connect({ onlyIfTrusted: false });
            if (resp && resp.publicKey) {
                return resp.publicKey.toString();
            }
        }

        alert('No Solana wallet extension found — please install a wallet such as Phantom to play.');
    } catch (err) {
        console.error('Wallet connection failed', err);
    }
    return null;
}

var debug = function (args) {
    if (console && console.log) {
        console.log(args);
    }
};

// Safari polyfills and fixes
if (/^((?!chrome|android).)*safari/i.test(navigator.userAgent)) {
    // Fix for Safari's handling of WebSocket
    if (!window.WebSocket.prototype.send) {
        window.WebSocket.prototype.send = function(data) {
            if (this.readyState === WebSocket.OPEN) {
                this.dispatchEvent(new MessageEvent('message', { data: data }));
            }
        };
    }

    // Fix for Safari's handling of requestAnimationFrame
    if (!window.requestAnimationFrame) {
        window.requestAnimationFrame = function(callback) {
            return setTimeout(callback, 1000 / 60);
        };
    }
    if (!window.cancelAnimationFrame) {
        window.cancelAnimationFrame = function(id) {
            clearTimeout(id);
        };
    }
}

// Mobile detection
if (/Android|webOS|iPhone|iPad|iPod|BlackBerry/i.test(navigator.userAgent)) {
    global.mobile = true;
}

function startGame(type, name, walletAddress) {
    if (type === 'player') {
        global.playerName = name;
        global.walletAddress = walletAddress;
    }
    global.playerType = type;

    global.screen.width = window.innerWidth;
    global.screen.height = window.innerHeight;

    document.getElementById('startMenuWrapper').style.maxHeight = '0px';
    document.getElementById('gameAreaWrapper').style.opacity = 1;
    if (!socket) {
        socket = io({
            query: "type=" + type,
            transports: ['websocket', 'polling'],
            upgrade: true,
            rememberUpgrade: true,
            reconnection: true,
            reconnectionAttempts: 5,
            reconnectionDelay: 1000
        });
        setupSocket(socket);
    }
    if (!global.animLoopHandle)
        animloop();
    socket.emit('respawn');
    window.chat.socket = socket;
    window.chat.registerFunctions();
    window.canvas.socket = socket;
    global.socket = socket;
}

// Nickname validation is no longer required as the name is derived from the wallet.

window.onload = function () {
    const btn = document.getElementById('startButton');
    const btnS = document.getElementById('spectateButton');
    const settingsMenu = document.getElementById('settingsButton');
    const settingsPanel = document.getElementById('settings');

    if (btnS) {
        btnS.onclick = function () {
            startGame('spectator', 'Spectator', '');
        };
    }

    if (btn) {
        btn.onclick = async function () {
            if (!window.solana) {
                alert('No Solana wallet provider was found in this browser. Install Phantom or another Solana wallet extension and refresh.');
                return;
            }

            try {
                // Try to connect to any available wallet
                const resp = await window.solana.connect({ onlyIfTrusted: false });
                if (resp && resp.publicKey) {
                    const pubKey = resp.publicKey.toString();
                    const name = abbreviateAddress(pubKey);
                    startGame('player', name, pubKey);
                }
            } catch (err) {
                console.error('Wallet connection failed:', err);
                alert('Failed to connect wallet. Please try again.');
            }
        };
    }

    if (settingsMenu && settingsPanel) {
        settingsMenu.onclick = function () {
            if (settingsPanel.style.maxHeight == '300px') {
                settingsPanel.style.maxHeight = '0px';
            } else {
                settingsPanel.style.maxHeight = '300px';
            }
        };
    }

    // No keypress listener needed; player names come from wallet.
};

// TODO: Break out into GameControls.

var playerConfig = {
    border: 6,
    textColor: '#FFFFFF',
    textBorder: '#000000',
    textBorderSize: 3,
    defaultSize: 30
};

var player = {
    id: -1,
    x: global.screen.width / 2,
    y: global.screen.height / 2,
    screenWidth: global.screen.width,
    screenHeight: global.screen.height,
    target: { x: global.screen.width / 2, y: global.screen.height / 2 }
};
global.player = player;

var foods = [];
var viruses = [];
var fireFood = [];
var users = [];
var leaderboard = [];
var target = { x: player.x, y: player.y };
global.target = target;

window.canvas = new Canvas();
window.chat = new ChatClient();

var visibleBorderSetting = document.getElementById('visBord');
visibleBorderSetting.onchange = function() { window.chat.toggleBorder(); };

var showMassSetting = document.getElementById('showMass');
showMassSetting.onchange = function() { window.chat.toggleMass(); };

var continuitySetting = document.getElementById('continuity');
continuitySetting.onchange = function() { window.chat.toggleContinuity(); };

var roundFoodSetting = document.getElementById('roundFood');
roundFoodSetting.onchange = function() { window.chat.toggleRoundFood(); };

var c = window.canvas.cv;
var graph = c.getContext('2d');

$("#feed").click(function () {
    socket.emit('1');
    window.canvas.reenviar = false;
});

$("#split").click(function () {
    socket.emit('2');
    window.canvas.reenviar = false;
});

function handleDisconnect() {
    socket.close();
    if (!global.kicked) { // We have a more specific error message 
        render.drawErrorMessage('Disconnected!', graph, global.screen);
    }
}

// socket stuff.
function setupSocket(socket) {
    // Handle ping.
    socket.on('pongcheck', function () {
        var latency = Date.now() - global.startPingTime;
        debug('Latency: ' + latency + 'ms');
        window.chat.addSystemLine('Ping: ' + latency + 'ms');
    });

    // Handle error.
    socket.on('connect_error', handleDisconnect);
    socket.on('disconnect', handleDisconnect);

    // Handle connection.
    socket.on('welcome', function (playerSettings, gameSizes) {
        player = playerSettings;
        player.name = global.playerName;
        player.screenWidth = global.screen.width;
        player.screenHeight = global.screen.height;
        player.target = window.canvas.target;
        global.player = player;
        window.chat.player = player;
        socket.emit('gotit', player);
        global.gameStart = true;
        window.chat.addSystemLine('Connected to the game!');
        window.chat.addSystemLine('Type <b>-help</b> for a list of commands.');
        if (global.mobile) {
            document.getElementById('gameAreaWrapper').removeChild(document.getElementById('chatbox'));
        }
        c.focus();
        global.game.width = gameSizes.width;
        global.game.height = gameSizes.height;
        resize();
    });

    socket.on('playerDied', (data) => {
        const player = isUnnamedCell(data.playerEatenName) ? 'An unnamed cell' : data.playerEatenName;
        //window.chat.addSystemLine('{GAME} - <b>' + (player) + '</b> was eaten by <b>' + (killer) + '</b>');
        window.chat.addSystemLine('{GAME} - <b>' + (player) + '</b> was eaten');
    });

    socket.on('playerDisconnect', (data) => {
        window.chat.addSystemLine('{GAME} - <b>' + (isUnnamedCell(data.name) ? 'An unnamed cell' : data.name) + '</b> disconnected.');
    });

    socket.on('playerJoin', (data) => {
        window.chat.addSystemLine('{GAME} - <b>' + (isUnnamedCell(data.name) ? 'An unnamed cell' : data.name) + '</b> joined.');
    });

    socket.on('leaderboard', (data) => {
        leaderboard = data.leaderboard;
        var status = '<span class="title">Leaderboard</span>';
        for (var i = 0; i < leaderboard.length; i++) {
            status += '<br />';
            const playerName = leaderboard[i].name.length !== 0 ? leaderboard[i].name : 'An unnamed cell';
            const walletAddress = leaderboard[i].walletAddress ? abbreviateAddress(leaderboard[i].walletAddress) : '';
            const valuation = leaderboard[i].valuation ? ` (${leaderboard[i].valuation.toFixed(3)} SOL)` : '';
            
            if (leaderboard[i].id == player.id) {
                status += `<span class="me">${i + 1}. ${playerName}${walletAddress ? ' (' + walletAddress + ')' : ''}${valuation}</span>`;
            } else {
                status += `${i + 1}. ${playerName}${walletAddress ? ' (' + walletAddress + ')' : ''}${valuation}`;
            }
        }
        document.getElementById('status').innerHTML = status;
    });

    socket.on('serverMSG', function (data) {
        window.chat.addSystemLine(data);
    });

    // Chat.
    socket.on('serverSendPlayerChat', function (data) {
        window.chat.addChatLine(data.sender, data.message, false);
    });

    // Handle movement.
    socket.on('serverTellPlayerMove', function (playerData, userData, foodsList, massList, virusList) {
        if (global.playerType == 'player') {
            player.x = playerData.x;
            player.y = playerData.y;
            player.hue = playerData.hue;
            player.massTotal = playerData.massTotal;
            player.cells = playerData.cells;
        }
        users = userData;
        foods = foodsList;
        viruses = virusList;
        fireFood = massList;
    });

    // Death.
    socket.on('RIP', function () {
        global.gameStart = false;
        render.drawErrorMessage('You died!', graph, global.screen);
        window.setTimeout(() => {
            document.getElementById('gameAreaWrapper').style.opacity = 0;
            document.getElementById('startMenuWrapper').style.maxHeight = '1000px';
            if (global.animLoopHandle) {
                window.cancelAnimationFrame(global.animLoopHandle);
                global.animLoopHandle = undefined;
            }
        }, 2500);
    });

    socket.on('kick', function (reason) {
        global.gameStart = false;
        global.kicked = true;
        if (reason !== '') {
            render.drawErrorMessage('You were kicked for: ' + reason, graph, global.screen);
        }
        else {
            render.drawErrorMessage('You were kicked!', graph, global.screen);
        }
        socket.close();
    });

    socket.on('rewardEarned', (data) => {
        const rewardMessage = `{REWARD} - <b>${data.player}</b> earned ${data.amount.toFixed(3)} SOL for eating <b>${data.eatenPlayer}</b>! (Fee: ${data.fee.toFixed(3)} SOL)`;
        window.chat.addSystemLine(rewardMessage);
        
        // Show a floating notification
        const notification = document.createElement('div');
        notification.className = 'reward-notification';
        notification.innerHTML = `+${data.amount.toFixed(3)} SOL`;
        notification.style.position = 'absolute';
        notification.style.left = '50%';
        notification.style.top = '50%';
        notification.style.transform = 'translate(-50%, -50%)';
        notification.style.color = '#4CAF50';
        notification.style.fontSize = '24px';
        notification.style.fontWeight = 'bold';
        notification.style.textShadow = '0 0 10px rgba(76, 175, 80, 0.5)';
        notification.style.animation = 'fadeOut 2s forwards';
        
        document.getElementById('gameAreaWrapper').appendChild(notification);
        
        // Remove notification after animation
        setTimeout(() => {
            notification.remove();
        }, 2000);
    });

    socket.on('rageQuitPayout', (data) => {
        const message = `{RAGE QUIT} - <b>${data.from}</b> quit early! Their ${gameRules.ENTRY_FEE} SOL was sent to <b>${data.to}</b>`;
        window.chat.addSystemLine(message);
    });
}

const isUnnamedCell = (name) => name.length < 1;

const getPosition = (entity, player, screen) => {
    return {
        x: entity.x - player.x + screen.width / 2,
        y: entity.y - player.y + screen.height / 2
    }
}

window.requestAnimFrame = (function () {
    return window.requestAnimationFrame ||
        window.webkitRequestAnimationFrame ||
        window.mozRequestAnimationFrame ||
        window.msRequestAnimationFrame ||
        function (callback) {
            window.setTimeout(callback, 1000 / 60);
        };
})();

window.cancelAnimFrame = (function (handle) {
    return window.cancelAnimationFrame ||
        window.mozCancelAnimationFrame;
})();

function animloop() {
    global.animLoopHandle = window.requestAnimFrame(animloop);
    gameLoop();
}

function gameLoop() {
    if (global.gameStart) {
        graph.fillStyle = global.backgroundColor;
        graph.fillRect(0, 0, global.screen.width, global.screen.height);

        render.drawGrid(global, player, global.screen, graph);
        foods.forEach(food => {
            let position = getPosition(food, player, global.screen);
            render.drawFood(position, food, graph);
        });
        fireFood.forEach(fireFood => {
            let position = getPosition(fireFood, player, global.screen);
            render.drawFireFood(position, fireFood, playerConfig, graph);
        });
        viruses.forEach(virus => {
            let position = getPosition(virus, player, global.screen);
            render.drawVirus(position, virus, graph);
        });


        let borders = { // Position of the borders on the screen
            left: global.screen.width / 2 - player.x,
            right: global.screen.width / 2 + global.game.width - player.x,
            top: global.screen.height / 2 - player.y,
            bottom: global.screen.height / 2 + global.game.height - player.y
        }
        if (global.borderDraw) {
            render.drawBorder(borders, graph);
        }

        var cellsToDraw = [];
        for (var i = 0; i < users.length; i++) {
            let color = 'hsl(' + users[i].hue + ', 100%, 50%)';
            let borderColor = 'hsl(' + users[i].hue + ', 100%, 45%)';
            for (var j = 0; j < users[i].cells.length; j++) {
                cellsToDraw.push({
                    color: color,
                    borderColor: borderColor,
                    mass: users[i].cells[j].mass,
                    name: users[i].name,
                    radius: users[i].cells[j].radius,
                    x: users[i].cells[j].x - player.x + global.screen.width / 2,
                    y: users[i].cells[j].y - player.y + global.screen.height / 2
                });
            }
        }
        cellsToDraw.sort(function (obj1, obj2) {
            return obj1.mass - obj2.mass;
        });
        render.drawCells(cellsToDraw, playerConfig, global.toggleMassState, borders, graph);

        socket.emit('0', window.canvas.target); // playerSendTarget "Heartbeat".
    }
}

window.addEventListener('resize', resize);

function resize() {
    if (!socket) return;

    player.screenWidth = c.width = global.screen.width = global.playerType == 'player' ? window.innerWidth : global.game.width;
    player.screenHeight = c.height = global.screen.height = global.playerType == 'player' ? window.innerHeight : global.game.height;

    if (global.playerType == 'spectator') {
        player.x = global.game.width / 2;
        player.y = global.game.height / 2;
    }

    socket.emit('windowResized', { screenWidth: global.screen.width, screenHeight: global.screen.height });
}

// Expose for React wallet component
window.startGame = startGame;

// Import React wallet UI (compiled by webpack)
require('./wallet-root.jsx');

// Add CSS for reward notification animation
const style = document.createElement('style');
style.textContent = `
    @keyframes fadeOut {
        0% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        100% { opacity: 0; transform: translate(-50%, -50%) scale(1.5); }
    }
`;
document.head.appendChild(style);

