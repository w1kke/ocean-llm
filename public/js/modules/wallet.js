// Wallet management module
let userAddress = null;
let web3;

async function connectWallet() {
    if (typeof window.ethereum !== 'undefined') {
        try {
            const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
            userAddress = accounts[0];
            window.userAddress = userAddress; // Update global reference
            web3 = new Web3(window.ethereum);
            window.web3 = web3; // Ensure web3 is also globally available
            
            document.getElementById('walletConnectBtn').textContent = 
                `${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`;
            document.getElementById('walletDisconnectBtn').disabled = false;
            document.getElementById('createNftBtn').disabled = false;
            document.getElementById('addFriendBtn').disabled = false;
            document.getElementById('nftAccessBtn').disabled = false;
            
            // Load friends list
            window.loadFriends();
            
            // Start fetching assets
            await window.fetchAndDisplayAssets();
            if (window.assetsUpdateInterval) clearInterval(window.assetsUpdateInterval);
            window.assetsUpdateInterval = setInterval(window.fetchAndDisplayAssets, 30000);

            // Handle account changes
            window.ethereum.on('accountsChanged', function (accounts) {
                if (accounts.length === 0) {
                    resetWalletState();
                } else {
                    userAddress = accounts[0];
                    window.userAddress = accounts[0]; // Update global reference
                    document.getElementById('walletConnectBtn').textContent = 
                        `${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`;
                    document.getElementById('walletDisconnectBtn').disabled = false;
                    document.getElementById('createNftBtn').disabled = false;
                    document.getElementById('addFriendBtn').disabled = false;
                    document.getElementById('nftAccessBtn').disabled = false;
                    window.loadFriends();
                }
            });
        } catch (error) {
            console.error('Error connecting to wallet:', error);
            alert('Failed to connect wallet: ' + error.message);
        }
    } else {
        alert('Please install MetaMask to use this application');
    }
}

async function disconnectWallet() {
    resetWalletState();
    if (window.ethereum && window.ethereum.removeAllListeners) {
        window.ethereum.removeAllListeners('accountsChanged');
    }
}

function resetWalletState() {
    userAddress = null;
    window.userAddress = null; // Update global reference
    document.getElementById('walletConnectBtn').textContent = 'Connect Wallet';
    document.getElementById('walletDisconnectBtn').disabled = true;
    document.getElementById('createNftBtn').disabled = true;
    document.getElementById('addFriendBtn').disabled = true;
    document.getElementById('nftAccessBtn').disabled = true;
    window.friends = [];
    window.renderFriendsList();
    if (window.assetsUpdateInterval) {
        clearInterval(window.assetsUpdateInterval);
    }
}

function isValidEthereumAddress(address) {
    return web3 && web3.utils.isAddress(address);
}

// Initialize button states and event handlers
document.addEventListener('DOMContentLoaded', function() {
    // Set up connect button
    const connectBtn = document.getElementById('walletConnectBtn');
    connectBtn.addEventListener('click', connectWallet);
    
    // Set up disconnect button
    const disconnectBtn = document.getElementById('walletDisconnectBtn');
    disconnectBtn.addEventListener('click', disconnectWallet);
    disconnectBtn.disabled = true;
    
    const nftAccessBtn = document.getElementById('nftAccessBtn');
    if (nftAccessBtn) {
        nftAccessBtn.disabled = !window.userAddress;
    }
});

// Export functions and variables
window.userAddress = userAddress;
window.web3 = web3;
window.connectWallet = connectWallet;
window.disconnectWallet = disconnectWallet;
window.isValidEthereumAddress = isValidEthereumAddress;
