import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConnectionProvider, WalletProvider, useWallet } from '@solana/wallet-adapter-react';
import { WalletModalProvider, WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import { clusterApiUrl, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL, Connection } from '@solana/web3.js';
import '@solana/wallet-adapter-react-ui/styles.css';
import Swal from 'sweetalert2';

// Support both Phantom and Solflare
const wallets = [
    new PhantomWalletAdapter(),
    new SolflareWalletAdapter()
];

const endpoint = clusterApiUrl('devnet');
const ENTRY_FEE = 0.1; // 0.1 SOL
const MIN_CASHOUT_MASS = 1000000; // 1M mass required for cashout
const CASHOUT_FEE_PERCENTAGE = 5; // 5% fee on cashout

// Game server's wallet address - will be set by server
let GAME_WALLET = null;

// Initialize connection
const connection = new Connection(endpoint, 'confirmed');

// Terminal logging function
function logToTerminal(message) {
    console.log(`[WAGAR] ${message}`);
    // Also log to server if socket is available
    if (window.socket) {
        window.socket.emit('walletLog', message);
    }
}

// Get game wallet from server
async function getGameWallet() {
    try {
        const response = await fetch('/api/game-wallet');
        const data = await response.json();
        GAME_WALLET = new PublicKey(data.publicKey);
        logToTerminal('Game wallet initialized');
    } catch (err) {
        console.error('Failed to get game wallet:', err);
        logToTerminal('ERROR: Failed to get game wallet');
    }
}

function FeeDisclaimer() {
    const [isVisible, setIsVisible] = useState(true);

    if (!isVisible) return null;

    return (
        <div style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: 'rgba(0, 0, 0, 0.9)',
            padding: '20px',
            borderRadius: '10px',
            color: 'white',
            textAlign: 'center',
            maxWidth: '80%',
            zIndex: 1000
        }}>
            <h2 style={{ color: '#ff4444', marginBottom: '15px' }}>⚠️ Important Fee Information</h2>
            <p>Entry Fee: {ENTRY_FEE} SOL</p>
            <p>Cashout Fee: {CASHOUT_FEE_PERCENTAGE}% of winnings</p>
            <p style={{ color: '#ff4444', marginTop: '15px' }}>
                By playing, you agree to these fees. The game is experimental and played at your own risk.
            </p>
            <button 
                onClick={() => setIsVisible(false)}
                style={{
                    marginTop: '15px',
                    padding: '8px 16px',
                    background: '#4CAF50',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer'
                }}
            >
                I Understand
            </button>
        </div>
    );
}

function CashOutButton({ mass, onCashOut }) {
    const [timeLeft, setTimeLeft] = useState(60);
    const [earnings, setEarnings] = useState(ENTRY_FEE * 0.9);

    useEffect(() => {
        const baseEarnings = ENTRY_FEE * 0.9;
        const massEarnings = (mass * 0.00001).toFixed(4);
        const totalEarnings = (parseFloat(massEarnings) + baseEarnings).toFixed(4);
        setEarnings(totalEarnings);
    }, [mass]);

    const handleCashOut = async () => {
        if (timeLeft === 0) {
            try {
                const result = await onCashOut();
                if (result && result.signature) {
                    await Swal.fire({
                        title: 'Cash Out Successful!',
                        html: `
                            <p>Your earnings have been sent to your wallet.</p>
                            <p>Initial Entry: ${ENTRY_FEE} SOL</p>
                            <p>Initial Fee (10%): ${(ENTRY_FEE * 0.1).toFixed(4)} SOL</p>
                            <p>Initial Net: ${(ENTRY_FEE * 0.9).toFixed(4)} SOL</p>
                            <p>Mass Earnings: ${(earnings - (ENTRY_FEE * 0.9)).toFixed(4)} SOL</p>
                            <p>Total Amount: ${earnings} SOL</p>
                            <p>Cash Out Fee (10%): ${(earnings * 0.1).toFixed(4)} SOL</p>
                            <p>Final Net: ${(earnings * 0.9).toFixed(4)} SOL</p>
                            <p><a href="https://explorer.solana.com/tx/${result.signature}?cluster=devnet" target="_blank">View on Solscan</a></p>
                        `,
                        icon: 'success',
                        confirmButtonText: 'Return to Home',
                        confirmButtonColor: '#4CAF50'
                    });
                    window.location.href = '/';
                }
            } catch (error) {
                Swal.fire({
                    title: 'Cash Out Failed',
                    text: error.message,
                    icon: 'error',
                    confirmButtonText: 'Try Again'
                });
            }
            setTimeLeft(60);
        }
    };

    return (
        <div style={{
            position: 'fixed',
            top: '10px',
            left: '10px',
            zIndex: 1000,
            background: 'rgba(0, 0, 0, 0.7)',
            padding: '10px',
            borderRadius: '5px',
            color: 'white',
            minWidth: '200px'
        }}>
            <div style={{ 
                marginBottom: '5px',
                fontSize: timeLeft > 0 ? '16px' : '14px',
                color: timeLeft > 0 ? '#ff4444' : '#4CAF50'
            }}>
                {timeLeft > 0 
                    ? `Cash out available in: ${Math.floor(timeLeft/60)}:${(timeLeft%60).toString().padStart(2, '0')}`
                    : 'Cash out available!'}
            </div>
            <div style={{
                marginBottom: '10px',
                padding: '8px',
                background: 'rgba(255, 255, 255, 0.1)',
                borderRadius: '4px'
            }}>
                <div style={{ fontSize: '14px', color: '#aaa' }}>Current Earnings:</div>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#4CAF50' }}>
                    {earnings} SOL
                </div>
                <div style={{ fontSize: '12px', color: '#aaa' }}>
                    Initial Entry: {ENTRY_FEE} SOL
                </div>
                <div style={{ fontSize: '12px', color: '#aaa' }}>
                    Mass Earnings: {(earnings - ENTRY_FEE).toFixed(4)} SOL
                </div>
                <div style={{ fontSize: '12px', color: '#aaa' }}>
                    Fee (10%): {(earnings * 0.1).toFixed(4)} SOL
                </div>
                <div style={{ fontSize: '12px', color: '#aaa' }}>
                    Net: {(earnings * 0.9).toFixed(4)} SOL
                </div>
            </div>
            <button
                onClick={handleCashOut}
                disabled={timeLeft > 0}
                style={{
                    padding: '8px 16px',
                    background: timeLeft === 0 ? '#4CAF50' : '#666',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: timeLeft === 0 ? 'pointer' : 'not-allowed',
                    width: '100%'
                }}
            >
                Cash Out
            </button>
            <div style={{ fontSize: '12px', marginTop: '5px', color: '#aaa' }}>
                Press Delete to exit
            </div>
        </div>
    );
}

function GameStarter() {
    const { connected, publicKey, sendTransaction, wallet } = useWallet();
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [hasAttemptedConnection, setHasAttemptedConnection] = useState(false);
    const [playerMass, setPlayerMass] = useState(0);
    const [showFeeDisclaimer, setShowFeeDisclaimer] = useState(true);
    const [hasPaidEntryFee, setHasPaidEntryFee] = useState(false);

    useEffect(() => {
        getGameWallet();
    }, []);

    useEffect(() => {
        if (window.socket) {
            window.socket.on('massUpdate', (mass) => {
                setPlayerMass(mass);
            });
        }
    }, []);

    useEffect(() => {
        if (wallet) {
            logToTerminal(`Wallet selected: ${wallet.adapter.name}`);
        }
    }, [wallet]);

    const handleCashOut = async () => {
        if (!connected || !publicKey || !GAME_WALLET) return;
        
        try {
            setIsLoading(true);
            logToTerminal('Processing cash out...');

            const transaction = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: GAME_WALLET,
                    toPubkey: publicKey,
                    lamports: LAMPORTS_PER_SOL * ENTRY_FEE * 0.9
                })
            );

            const signature = await sendTransaction(transaction, connection);
            await connection.confirmTransaction(signature, 'confirmed');
            
            logToTerminal(`Cash out successful: ${signature}`);
            return { signature };
        } catch (err) {
            console.error('Cash out failed:', err);
            logToTerminal(`ERROR: Cash out failed - ${err.message}`);
            throw err;
        } finally {
            setIsLoading(false);
        }
    };

    const handleStartGame = async () => {
        if (!connected || !publicKey || !GAME_WALLET) {
            setError('Please connect your wallet first');
            return;
        }

        try {
            setIsLoading(true);
            setError(null);
            logToTerminal('Processing entry fee...');

            const transaction = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: publicKey,
                    toPubkey: GAME_WALLET,
                    lamports: LAMPORTS_PER_SOL * ENTRY_FEE
                })
            );

            const signature = await sendTransaction(transaction, connection);
            await connection.confirmTransaction(signature, 'confirmed');
            
            logToTerminal(`Entry fee paid: ${signature}`);
            setHasPaidEntryFee(true);

            if (typeof window.startGame === 'function') {
                window.startGame('player', publicKey.toString().slice(0, 4), publicKey.toString());
            } else {
                console.error('startGame function not found');
                setError('Failed to start game. Please refresh the page.');
                logToTerminal('ERROR: startGame function not found');
            }
        } catch (err) {
            console.error('Failed to pay entry fee:', err);
            setError('Failed to pay entry fee. Please try again.');
            logToTerminal(`ERROR: Failed to pay entry fee - ${err.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (connected && publicKey && !isLoading && !error && !hasAttemptedConnection && !hasPaidEntryFee) {
            setHasAttemptedConnection(true);
            logToTerminal(`Wallet connected: ${publicKey.toString()}`);
            handleStartGame();
        }
    }, [connected, publicKey, wallet, hasPaidEntryFee]);

    return (
        <div style={{ textAlign: 'center', marginTop: '10px' }}>
            <div style={{ marginTop: '10px' }}>
                <WalletMultiButton />
            </div>
            {isLoading && <p>Processing payment...</p>}
            {error && <p style={{ color: 'red' }}>{error}</p>}
            {connected && hasPaidEntryFee && <CashOutButton mass={playerMass} onCashOut={handleCashOut} />}
            {showFeeDisclaimer && <FeeDisclaimer />}
        </div>
    );
}

function WalletUI() {
    return (
        <ConnectionProvider endpoint={endpoint}>
            <WalletProvider wallets={wallets} autoConnect={false}>
                <WalletModalProvider>
                    <GameStarter />
                </WalletModalProvider>
            </WalletProvider>
        </ConnectionProvider>
    );
}

// Initialize React root
const container = document.getElementById('wallet-root');
if (container) {
    const root = createRoot(container);
    root.render(<WalletUI />);
}
