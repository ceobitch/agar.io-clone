const { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL, Keypair } = require('@solana/web3.js');
const bs58 = require('bs58');
require('dotenv').config();

// Use environment variable to select devnet or mainnet
const isDevnet = process.env.SOLANA_DEVNET === 'true';
const SOLANA_RPC_URL = isDevnet
  ? 'https://api.devnet.solana.com'
  : 'https://api.mainnet-beta.solana.com';

const connection = new Connection(SOLANA_RPC_URL, 'confirmed');

// Get game wallet private key from environment variable
const GAME_WALLET_PRIVATE_KEY = process.env.GAME_WALLET_PRIVATE_KEY;

// Initialize game wallet
let gameWallet;
let GAME_WALLET_PUBLIC_KEY = '';

if (GAME_WALLET_PRIVATE_KEY) {
    try {
        gameWallet = Keypair.fromSecretKey(bs58.decode(GAME_WALLET_PRIVATE_KEY));
        GAME_WALLET_PUBLIC_KEY = gameWallet.publicKey.toString();
        console.log('Game wallet initialized successfully');
    } catch (error) {
        console.error('ERROR: Invalid game wallet private key format!');
        // Don't exit process, just log error
    }
} else {
    console.warn('WARNING: GAME_WALLET_PRIVATE_KEY not set. Solana features will be disabled.');
}

// Calculate reward based on mass eaten
function calculateReward(eatenMass) {
    // Base reward is 0.1 SOL per 1000 mass points
    const baseReward = 0.1;
    const massFactor = eatenMass / 1000;
    return baseReward * massFactor;
}

// Send reward to player
async function sendReward(playerWallet, amount) {
    if (!gameWallet) {
        console.error('Cannot send reward: Game wallet not initialized');
        return false;
    }

    try {
        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: gameWallet.publicKey,
                toPubkey: new PublicKey(playerWallet),
                lamports: amount * LAMPORTS_PER_SOL
            })
        );

        // Get recent blockhash
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = gameWallet.publicKey;

        // Sign transaction with game wallet
        transaction.sign(gameWallet);

        // Send transaction
        const signature = await connection.sendRawTransaction(transaction.serialize());
        
        // Wait for confirmation
        const confirmation = await connection.confirmTransaction({
            signature,
            blockhash,
            lastValidBlockHeight
        }, 'confirmed');

        if (confirmation.value.err) {
            throw new Error('Transaction failed to confirm');
        }

        console.log(`Successfully sent ${amount} SOL to ${playerWallet}`);
        return true;
    } catch (error) {
        console.error('Failed to send reward:', error);
        return false;
    }
}

module.exports = {
    calculateReward,
    sendReward,
    gameWallet,
    GAME_WALLET_PUBLIC_KEY
}; 
