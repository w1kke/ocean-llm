let userAddress = null;
let web3;
let ipfsUrl = null;
let assetsUpdateInterval = null;
let friends = [];

function updateTransactionStatus(id, status, message) {
    const statusElement = document.querySelector(`#${id} .tx-state`);
    statusElement.textContent = message;
    statusElement.className = `tx-state ${status}`;
}

// Friends List Functions
function isValidEthereumAddress(address) {
    return web3 && web3.utils.isAddress(address);
}

function saveFriends() {
    localStorage.setItem(`friends_${userAddress}`, JSON.stringify(friends));
}

function loadFriends() {
    const savedFriends = localStorage.getItem(`friends_${userAddress}`);
    friends = savedFriends ? JSON.parse(savedFriends) : [];
    renderFriendsList();
}

function renderFriendsList() {
    const friendsList = document.getElementById('friendsList');
    friendsList.innerHTML = '';
    
    if (friends.length === 0) {
        friendsList.innerHTML = '<div class="friend-item">No friends added yet</div>';
        return;
    }
    
    friends.forEach((friend, index) => {
        const friendElement = document.createElement('div');
        friendElement.className = 'friend-item';
        friendElement.innerHTML = `
            <span class="friend-address">${friend.slice(0, 6)}...${friend.slice(-4)}</span>
            <button class="remove-friend" onclick="removeFriend(${index})">×</button>
        `;
        friendsList.appendChild(friendElement);
    });
}

function addFriend() {
    const addressInput = document.getElementById('friendAddress');
    const address = addressInput.value.trim();
    
    if (!isValidEthereumAddress(address)) {
        alert('Please enter a valid Ethereum address');
        return;
    }
    
    if (address === userAddress) {
        alert('You cannot add your own address');
        return;
    }
    
    if (friends.includes(address)) {
        alert('This address is already in your friends list');
        return;
    }
    
    friends.push(address);
    saveFriends();
    renderFriendsList();
    addressInput.value = '';
}

function removeFriend(index) {
    friends.splice(index, 1);
    saveFriends();
    renderFriendsList();
}

async function fetchAndDisplayAssets() {
    if (!userAddress) return;
    
    try {
        // Get current chain ID
        const chainId = await web3.eth.getChainId();
        
        const response = await fetch(`/api/user-assets/${userAddress}/${chainId}`);
        const data = await response.json();
        
        if (data.success && data.assets.length > 0) {
            const assetsContainer = document.getElementById('userAssets');
            assetsContainer.innerHTML = '';
            
            data.assets.forEach(asset => {
                const assetData = asset._source;
                const did = `${assetData.id || assetData.nft.address}`;
                const marketUrl = `https://market.oceanprotocol.com/asset/${did}`;
                const card = document.createElement('div');
                card.className = 'asset-card window';
                
                // Format the date nicely
                const createdDate = new Date(assetData.metadata.created).toLocaleString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });

                card.innerHTML = `
                    <div class="title-bar">
                        <div class="title-bar-text">${assetData.metadata.name}</div>
                        <div class="title-bar-controls">
                            <button aria-label="Minimize"></button>
                            <button aria-label="Maximize"></button>
                            <button aria-label="Close"></button>
                        </div>
                    </div>
                    <div class="window-body">
                        <div class="asset-preview">
                            <img src="${assetData.metadata.previewImageUrl || '/images/icq-flower.png'}" alt="NFT Preview" class="asset-image">
                        </div>
                        <p><strong>Description:</strong> ${assetData.metadata.description}</p>
                        <p><strong>Author:</strong> ${assetData.metadata.author}</p>
                        <p><strong>Created:</strong> ${createdDate}</p>
                        <p><strong>NFT Address:</strong> ${assetData.nft.address}</p>
                        <p><strong>Datatoken:</strong> ${assetData.datatokens[0].symbol}</p>
                        <div class="button-bar">
                            <button onclick="window.open('${marketUrl}', '_blank')" class="market-btn">
                                View in Ocean Market
                            </button>
                        </div>
                    </div>
                `;
                
                assetsContainer.appendChild(card);
            });
        } else {
            const assetsContainer = document.getElementById('userAssets');
            assetsContainer.innerHTML = `
                <div class="no-assets-message">
                    No NFTs found for this wallet on the current network. Create your first NFT above!
                </div>
            `;
        }
    } catch (error) {
        console.error('Error fetching assets:', error);
    }
}

async function connectWallet() {
    if (typeof window.ethereum !== 'undefined') {
        try {
            const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
            userAddress = accounts[0];
            web3 = new Web3(window.ethereum);
            
            document.getElementById('walletConnectBtn').textContent = 
                `Connected: ${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`;
            document.getElementById('createNftBtn').disabled = false;
            document.getElementById('addFriendBtn').disabled = false;
            
            // Load friends list
            loadFriends();
            
            // Start fetching assets
            await fetchAndDisplayAssets();
            if (assetsUpdateInterval) clearInterval(assetsUpdateInterval);
            assetsUpdateInterval = setInterval(fetchAndDisplayAssets, 30000);

            // Handle account changes
            window.ethereum.on('accountsChanged', function (accounts) {
                if (accounts.length === 0) {
                    userAddress = null;
                    document.getElementById('walletConnectBtn').textContent = 'Connect Wallet';
                    document.getElementById('createNftBtn').disabled = true;
                    document.getElementById('addFriendBtn').disabled = true;
                    friends = [];
                    renderFriendsList();
                } else {
                    userAddress = accounts[0];
                    document.getElementById('walletConnectBtn').textContent = `Connected: ${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`;
                    document.getElementById('createNftBtn').disabled = false;
                    document.getElementById('addFriendBtn').disabled = false;
                    loadFriends();
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

async function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const uploadStatus = document.getElementById('uploadStatus');
    uploadStatus.textContent = 'Uploading to IPFS...';
    uploadStatus.className = 'upload-status';

    const formData = new FormData();
    formData.append('file', file);

    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });

        const data = await response.json();
        if (data.success) {
            ipfsUrl = data.ipfsUrl;
            uploadStatus.textContent = `File uploaded successfully! IPFS URL: ${data.ipfsUrl}`;
            uploadStatus.className = 'upload-status success';
        } else {
            throw new Error(data.error || 'Upload failed');
        }
    } catch (error) {
        console.error('Error uploading file:', error);
        uploadStatus.textContent = 'Error uploading file: ' + error.message;
        uploadStatus.className = 'upload-status error';
        ipfsUrl = null;
    }
}

function addMessage(content, isUser = false) {
    const messagesDiv = document.getElementById('messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isUser ? 'user-message' : 'ai-message'}`;
    messageDiv.textContent = content;
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

async function waitForTransaction(txHash, statusId) {
    updateTransactionStatus(statusId, 'pending', 'Waiting for confirmation...');
    let confirmations = 0;
    
    while (confirmations < 1) {
        try {
            const receipt = await web3.eth.getTransactionReceipt(txHash);
            if (receipt) {
                if (receipt.status) {
                    updateTransactionStatus(statusId, 'success', 'Confirmed!');
                    return receipt;
                } else {
                    updateTransactionStatus(statusId, 'error', 'Failed');
                    throw new Error('Transaction failed');
                }
            }
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds before checking again
        } catch (error) {
            updateTransactionStatus(statusId, 'error', 'Error: ' + error.message);
            throw error;
        }
    }
}

async function createNft() {
    if (!userAddress) {
        alert('Please connect your wallet first');
        return;
    }

    const input = document.getElementById('chatInput');
    const prompt = input.value.trim();
    
    if (!prompt) {
        alert('Please enter a description for your NFT');
        return;
    }

    addMessage(prompt, true);
    document.getElementById('createNftBtn').disabled = true;
    document.getElementById('nftResult').textContent = '🤖 AI is working... Generating metadata...';

    try {
        const response = await fetch('/api/create-and-publish-nft', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                prompt,
                userAddress,
                ipfsUrl
            })
        });

        document.getElementById('nftResult').textContent = '🎨 Creating preview image...';
        const createData = await response.json();
        if (!createData.success) {
            throw new Error(createData.error || 'Failed to create NFT');
        }

        document.getElementById('nftResult').textContent = '✨ Preview ready!';

        // Create preview element
        const previewDiv = document.createElement('div');
        previewDiv.className = 'nft-preview';
        previewDiv.innerHTML = `
            ${createData.metadata.previewImageUrl ? `
                <div class="preview-image-container">
                    <h4>Sample Image:</h4>
                    <img src="${createData.metadata.previewImageUrl}" alt="NFT Preview" class="preview-image">
                </div>
            ` : ''}
            <div class="metadata-details">
                <h3>📝 Generated NFT Metadata:</h3>
                <p><strong>Name:</strong> ${createData.metadata.nftName}</p>
                <p><strong>Symbol:</strong> ${createData.metadata.nftSymbol}</p>
                <p><strong>Datatoken:</strong> ${createData.metadata.datatokenName} (${createData.metadata.datatokenSymbol})</p>
                <p><strong>Description:</strong> ${createData.metadata.description}</p>
                <p><strong>Author:</strong> ${createData.metadata.author}</p>
                <p><strong>Category:</strong> ${createData.metadata.category}</p>
                <p><strong>Tags:</strong> ${createData.metadata.tags.join(', ')}</p>
                ${createData.metadata.assetUrl ? `<p><strong>Main Asset:</strong> ${createData.metadata.assetUrl}</p>` : ''}
                <p><strong>Price:</strong> ${createData.metadata.suggestedPrice} Ocean Tokens</p>
            </div>
            <p class="confirmation-prompt">Would you like to create this NFT?</p>
        `;
    
        const messagesDiv = document.getElementById('messages');
        messagesDiv.appendChild(previewDiv);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;

        window.nftCreationData = createData;

        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'confirmation-buttons';
        buttonContainer.innerHTML = `
            <button onclick="proceedWithNftCreation()" class="btn confirm-btn">✅ Create NFT</button>
            <button onclick="location.reload()" class="btn cancel-btn">🔄 Start Over</button>
        `;
        
        input.style.display = 'none';
        document.getElementById('createNftBtn').style.display = 'none';
        document.querySelector('.input-group').appendChild(buttonContainer);

    } catch (error) {
        console.error('Error:', error);
        document.getElementById('nftResult').textContent = 'Error: ' + error.message;
        document.getElementById('createNftBtn').disabled = false;
    }
}

async function proceedWithNftCreation() {
    const createData = window.nftCreationData;
    if (!createData) {
        console.error('No NFT creation data found');
        return;
    }

    // Reset transaction statuses
    updateTransactionStatus('tx1Status', 'waiting', 'Waiting to start...');
    updateTransactionStatus('tx2Status', 'waiting', 'Waiting to start...');
    document.getElementById('nftResult').textContent = 'Creating NFT...';

    try {
        // Convert hex string to number if it's a hex string
        const gasLimit = createData.txData.gasLimit;
        const gasLimitValue = typeof gasLimit === 'string' && gasLimit.startsWith('0x') 
            ? parseInt(gasLimit, 16)
            : Number(gasLimit);

        // Prepare first transaction
        const txToSend = {
            to: createData.txData.to,
            from: userAddress,
            data: createData.txData.data,
            gas: web3.utils.numberToHex(gasLimitValue)
        };

        updateTransactionStatus('tx1Status', 'pending', 'Waiting for approval...');
        console.log('Sending first transaction:', txToSend);
        const tx = await web3.eth.sendTransaction(txToSend);
        console.log('NFT Creation Transaction:', tx);

        // Wait for the first transaction to be mined
        const receipt = await waitForTransaction(tx.transactionHash, 'tx1Status');
        console.log('receipt logs:', receipt.logs);
        const nftAddress = receipt.logs[2].address; // The third log contains the NFT address
        const datatokenAddress = receipt.logs[7].address;
        const dispenserAddress = receipt.logs[13].address; // double check this

        console.log(nftAddress);
        console.log(datatokenAddress);
        console.log(dispenserAddress);

        document.getElementById('nftResult').textContent = 'Preparing metadata encryption...';

        // Second API call to encrypt metadata
        const chainId = await web3.eth.getChainId();
        const encryptResponse = await fetch('/api/encrypt-metadata', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                nftAddress,
                datatokenAddress,
                dispenserAddress,
                metadata: createData.metadata,
                chainId,
                publisherAddress: userAddress
            })
        });

        const encryptData = await encryptResponse.json();
        if (!encryptData.success) {
            throw new Error(encryptData.error || 'Failed to encrypt metadata');
        }

        // Convert hex string to number if it's a hex string
        const gasLimit2 = encryptData.transaction.gasLimit;
        const gasLimitValue2 = typeof gasLimit2 === 'string' && gasLimit2.startsWith('0x')
            ? parseInt(gasLimit2, 16)
            : Number(gasLimit2);

        // Prepare second transaction
        const tx2ToSend = {
            to: encryptData.transaction.to,
            from: userAddress,
            data: encryptData.transaction.data,
            gas: web3.utils.numberToHex(gasLimitValue2)
        };

        updateTransactionStatus('tx2Status', 'pending', 'Waiting for approval...');
        console.log('Sending second transaction:', tx2ToSend);
        const tx2 = await web3.eth.sendTransaction(tx2ToSend);
        console.log('Metadata Transaction:', tx2);

        // Wait for the second transaction to be mined
        await waitForTransaction(tx2.transactionHash, 'tx2Status');

        document.getElementById('nftResult').textContent = `NFT created successfully! Address: ${nftAddress}`;
        
        // Refresh the assets display
        await fetchAndDisplayAssets();

    } catch (error) {
        console.error('Error:', error);
        document.getElementById('nftResult').textContent = 'Error: ' + error.message;
    }
}

// Event Listeners
document.getElementById('walletConnectBtn').addEventListener('click', connectWallet);
document.getElementById('createNftBtn').addEventListener('click', createNft);
document.getElementById('fileInput').addEventListener('change', handleFileUpload);
document.getElementById('chatInput').addEventListener('keypress', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        createNft();
    }
});

// Friends List Event Listeners
document.getElementById('addFriendBtn').addEventListener('click', addFriend);
document.getElementById('friendAddress').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        addFriend();
    }
});
