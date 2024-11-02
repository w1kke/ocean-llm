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
                `Connected: ${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`;
            document.getElementById('createNftBtn').disabled = false;
            document.getElementById('addFriendBtn').disabled = false;
            
            // Load friends list
            window.loadFriends();
            
            // Start fetching assets
            await window.fetchAndDisplayAssets();
            if (window.assetsUpdateInterval) clearInterval(window.assetsUpdateInterval);
            window.assetsUpdateInterval = setInterval(window.fetchAndDisplayAssets, 30000);

            // Handle account changes
            window.ethereum.on('accountsChanged', function (accounts) {
                if (accounts.length === 0) {
                    userAddress = null;
                    window.userAddress = null; // Update global reference
                    document.getElementById('walletConnectBtn').textContent = 'Connect Wallet';
                    document.getElementById('createNftBtn').disabled = true;
                    document.getElementById('addFriendBtn').disabled = true;
                    window.friends = [];
                    window.renderFriendsList();
                } else {
                    userAddress = accounts[0];
                    window.userAddress = accounts[0]; // Update global reference
                    document.getElementById('walletConnectBtn').textContent = `Connected: ${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`;
                    document.getElementById('createNftBtn').disabled = false;
                    document.getElementById('addFriendBtn').disabled = false;
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

function isValidEthereumAddress(address) {
    return web3 && web3.utils.isAddress(address);
}

// Export functions and variables
window.userAddress = userAddress;
window.web3 = web3;
window.connectWallet = connectWallet;
window.isValidEthereumAddress = isValidEthereumAddress;
