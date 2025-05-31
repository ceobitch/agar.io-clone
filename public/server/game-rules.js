"use strict";

const {
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL
} = require('@solana/web3.js');

// Game constants
const ENTRY_FEE = 0.1; // SOL
const FEE_PERCENTAGE = 0.1; // 10%
const GRACE_PERIOD = 10; // seconds
const MIN_PLAY_TIME = 60; // seconds

// Track active players
const activePlayers = new Map();

// Track player state
function addPlayer(walletAddress) {
  activePlayers.set(walletAddress, {
    isAlive: true,
    joinTime: Date.now(),
    lastHitBy: null,
    disconnectTime: null,
    isDisconnected: false
  });
}
function removePlayer(walletAddress) {
  // Only remove if player is dead, not just disconnected
  const player = activePlayers.get(walletAddress);
  if (player && !player.isAlive) {
    activePlayers.delete(walletAddress);
  }
}
function updateLastHitBy(walletAddress, hitByWallet) {
  const player = activePlayers.get(walletAddress);
  if (player) {
    player.lastHitBy = hitByWallet;
  }
}
function handleDisconnect(walletAddress) {
  const player = activePlayers.get(walletAddress);
  if (player) {
    // Just mark as disconnected but keep in game
    player.isDisconnected = true;
    player.disconnectTime = Date.now();
  }
}
function handleReconnect(walletAddress) {
  const player = activePlayers.get(walletAddress);
  if (player) {
    player.isDisconnected = false;
    player.disconnectTime = null;
  }
}

// Always return true to keep players in game
function isInGracePeriod(walletAddress) {
  return true;
}

// Always return true to allow players to stay
function canQuit(walletAddress) {
  return true;
}

// Calculate reward with fee
function calculateRewardWithFee(amount) {
  const fee = amount * FEE_PERCENTAGE;
  const reward = amount - fee;
  return {
    reward,
    fee
  };
}

// Create reward transaction
function createRewardTransaction(fromWallet, toWallet, amount) {
  const {
    reward,
    fee
  } = calculateRewardWithFee(amount);
  const transaction = new Transaction().add(SystemProgram.transfer({
    fromPubkey: new PublicKey(fromWallet),
    toPubkey: new PublicKey(toWallet),
    lamports: reward * LAMPORTS_PER_SOL
  }));
  return {
    transaction,
    reward,
    fee
  };
}
module.exports = {
  ENTRY_FEE,
  FEE_PERCENTAGE,
  GRACE_PERIOD,
  MIN_PLAY_TIME,
  addPlayer,
  removePlayer,
  updateLastHitBy,
  handleDisconnect,
  handleReconnect,
  canQuit,
  isInGracePeriod,
  calculateRewardWithFee,
  createRewardTransaction
};