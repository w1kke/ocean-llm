// Asset display and sharing module
let assetsUpdateInterval = null;
let selectedNFTForSharing = null;

async function fetchAndDisplayAssets() {
    if (!window.userAddress) return;

    try {
        // Get current chain ID
        const chainId = await window.web3.eth.getChainId();

        const response = await fetch(`/api/user-assets/${window.userAddress}/${chainId}`);
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
                            <img src="${assetData.metadata.previewImageUrl || '/images/NoImageFound.png'}" alt="NFT Preview" class="asset-image">
                        </div>
                        <p><strong>Description:</strong> ${assetData.metadata.description}</p>
                        <p><strong>Author:</strong> ${assetData.metadata.author}</p>
                        <p><strong>Created:</strong> ${createdDate}</p>
                        <p><strong>NFT Address:</strong> ${assetData.nft.address}</p>
                        <p><strong>Datatoken:</strong> ${assetData.datatokens[0].symbol}</p>
                        <p><strong>Datatoken Address:</strong> ${assetData.datatokens[0].address}</p>
                        <div class="button-bar">
                        <button onclick="window.openAsset('${assetData.nft.address}', '${assetData.datatokens[0].address}')" class="open-btn">
                            Open
                        </button>
                        <button onclick="window.showShareDialog('${assetData.nft.address}', '${assetData.datatokens[0].address}')" class="share-btn">
                            Share Access
                        </button>
                        <button onclick="window.open('${marketUrl}', '_blank')" class="market-btn">
                            View in Ocean Market
                        </button>
                        <button onclick="window.showDeleteConfirmation('${assetData.nft.address}', '${assetData.metadata.name}')" class="delete-btn">
                            Delete
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


async function openAsset(nftAddress, datatokenAddress) {
    try {
        const statusDiv = document.createElement('div');
        statusDiv.className = 'status-overlay';
        statusDiv.innerHTML = `
            <div class="status-window window">
                <div class="title-bar">
                    <div class="title-bar-text">Opening Asset</div>
                </div>
                <div class="window-body">
                    <div class="transaction-status">
                        <div id="openAssetStatus" class="tx-status">
                            <span class="tx-label">Status:</span>
                            <span class="tx-state waiting">Preparing...</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(statusDiv);

        const chainId = await window.web3.eth.getChainId();

        // Step 1: Get consume transaction data
        window.updateTransactionStatus('openAssetStatus', 'pending', 'Preparing consume transaction...');
        const consumeResponse = await fetch('/api/consume-asset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                nftAddress,
                datatokenAddress,
                userAddress: window.userAddress,
                chainId
            })
        });

        const consumeData = await consumeResponse.json();
        if (!consumeData.success) {
            throw new Error(consumeData.error);
        }

        let orderTxId;

        // Execute transactions in sequence and wait for confirmations
        for (const tx of consumeData.transactions) {
            window.updateTransactionStatus('openAssetStatus', 'pending', tx.message);
            
            // Send transaction
            const txHash = await window.ethereum.request({
                method: 'eth_sendTransaction',
                params: [{
                    ...tx.data,
                    from: window.userAddress
                }]
            });

            // Wait for transaction confirmation
            console.log(`Waiting for transaction ${txHash} to be mined...`);
            const receipt = await window.waitForTransaction(txHash);
            console.log(`Transaction confirmed:`, receipt);

            // Check if transaction was successful
            if (!receipt.status) {
                throw new Error(`Transaction failed: ${txHash}`);
            }

            // Since we know the order tx is always the last one
            if (tx === consumeData.transactions[consumeData.transactions.length - 1]) {
                orderTxId = receipt.transactionHash;
                console.log(`Order transaction ID: ${orderTxId}`);
            }
        }

        if (!orderTxId) {
            throw new Error('Failed to get order transaction ID');
        }

        // Get download URL
        window.updateTransactionStatus('openAssetStatus', 'pending', 'Getting download URL...');
        const downloadResponse = await fetch('/api/get-download-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                did: consumeData.did,
                serviceId: consumeData.serviceId,
                orderTxId,
                userAddress: window.userAddress,
                fileIndex: consumeData.serviceIndex || 0
            })
        });

        const downloadData = await downloadResponse.json();
        if (!downloadData.success) {
            throw new Error(downloadData.error);
        }

        // Create message to sign (did + nonce)
        const message = downloadData.did + downloadData.nonce;
        console.log('Message to sign:', message);
        
        // Get message hash using web3
        const messageHash = window.web3.utils.soliditySha3(
            { t: 'bytes', v: window.web3.utils.utf8ToHex(message) }
        );
        console.log('Message hash:', messageHash);

        // Sign with MetaMask
        const signature = await window.ethereum.request({
            method: 'personal_sign',
            params: [messageHash, window.userAddress]
        });
        console.log('Signature:', signature);

        // Construct final download URL with all required parameters
        const downloadUrl = `${downloadData.downloadUrl}?` +
            `fileIndex=${downloadData.fileIndex}&` +
            `documentId=${downloadData.did}&` +
            `serviceId=${downloadData.serviceId}&` +
            `transferTxId=${orderTxId}&` +
            `consumerAddress=${window.userAddress}&` +
            `nonce=${downloadData.nonce}&` +
            `signature=${signature}`;

        console.log('[DEBUG] Final Download URL:', downloadUrl);

        // Start download
        window.location.href = downloadUrl;

        // Success LFG
        window.updateTransactionStatus('openAssetStatus', 'success', 'Download started!');
        setTimeout(() => statusDiv.remove(), 2000);

    } catch (error) {
        console.error('Error opening asset:', error);
        const statusElement = document.querySelector('#openAssetStatus .tx-state');
        if (statusElement) {
            statusElement.className = 'tx-state error';
            statusElement.textContent = 'Error: ' + error.message;
        }
        setTimeout(() => document.querySelector('.status-overlay')?.remove(), 3000);
    }
}

// Helper function to wait for transaction confirmation
async function waitForTransaction(txHash) {
    let receipt = null;
    while (!receipt) {
        try {
            receipt = await window.web3.eth.getTransactionReceipt(txHash);
            if (!receipt) {
                await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds before checking again
            }
        } catch (error) {
            console.error('Error checking transaction:', error);
            throw error;
        }
    }
    return receipt;
}


// Helper function to update transaction status
function updateTransactionStatus(statusId, state, message) {
    const statusElement = document.querySelector(`#${statusId} .tx-state`);
    if (statusElement) {
        statusElement.className = `tx-state ${state}`;
        statusElement.textContent = message;
    }
}


function showShareDialog(nftAddress, datatokenAddress) {
    selectedNFTForSharing = { nftAddress, datatokenAddress };

    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    document.body.appendChild(overlay);

    // Create dialog
    const dialog = document.createElement('div');
    dialog.className = 'share-dialog window';
    dialog.innerHTML = `
        <div class="title-bar">
            <div class="title-bar-text">Share NFT Access</div>
            <div class="title-bar-controls">
                <button aria-label="Close" onclick="window.closeShareDialog()"></button>
            </div>
        </div>
        <div class="window-body">
            <p>Select a friend to share access with:</p>
            <div class="share-dialog-content" id="shareFriendsList">
                ${window.friends && window.friends.length > 0 ?
            window.friends.map(friend => `
                        <div class="share-friend-item" onclick="window.toggleFriendSelection(this, '${friend}')">
                            ${friend.slice(0, 6)}...${friend.slice(-4)}
                            <input type="hidden" value="${friend}">
                        </div>
                    `).join('') :
            '<p>No friends added yet. Add friends to share your NFT access.</p>'
        }
            </div>
            <div class="dialog-buttons">
                <button class="btn" onclick="window.closeShareDialog()">Cancel</button>
                <button class="btn" onclick="window.shareAccess()" id="shareButton" ${!window.friends || window.friends.length === 0 ? 'disabled' : ''}>Share</button>
            </div>
        </div>
    `;
    document.body.appendChild(dialog);
}

function closeShareDialog() {
    const dialog = document.querySelector('.share-dialog');
    const overlay = document.querySelector('.overlay');
    if (dialog) dialog.remove();
    if (overlay) overlay.remove();
    selectedNFTForSharing = null;
}

function toggleFriendSelection(element, friendAddress) {
    const allItems = document.querySelectorAll('.share-friend-item');
    allItems.forEach(item => item.classList.remove('selected'));
    element.classList.add('selected');
}



async function shareAccess() {
    const selectedFriend = document.querySelector('.share-friend-item.selected');
    if (!selectedFriend || !selectedNFTForSharing) return;

    // Get the full address from the hidden input
    const friendAddress = selectedFriend.querySelector('input[type="hidden"]').value;

    try {
        // Show status in the UI
        const statusDiv = document.createElement('div');
        statusDiv.className = 'transaction-status';
        statusDiv.innerHTML = `
            <div id="mintStatus" class="tx-status">
                <span class="tx-label">Sharing Access:</span>
                <span class="tx-state waiting">Waiting for approval...</span>
            </div>
        `;
        document.querySelector('.share-dialog .window-body').appendChild(statusDiv);

        // Get the datatoken contract ABI
        const datatokenAbi = [
            {
                "inputs": [
                    { "internalType": "address", "name": "account", "type": "address" },
                    { "internalType": "uint256", "name": "amount", "type": "uint256" }
                ],
                "name": "mint",
                "outputs": [],
                "stateMutability": "nonpayable",
                "type": "function"
            }
        ];

        // Create contract instance for the datatoken
        const datatokenContract = new window.web3.eth.Contract(
            datatokenAbi,
            selectedNFTForSharing.datatokenAddress
        );

        // Mint 1 datatoken (using 18 decimals, so 1 = 1000000000000000000)
        const amount = '1000000000000000000';
        const mintTx = await datatokenContract.methods.mint(friendAddress, amount).send({
            from: window.userAddress
        });

        // Update status
        window.updateTransactionStatus('mintStatus', 'success', 'Access shared successfully!');

        // Wait for 2 seconds to show success status before closing
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Close the dialog
        closeShareDialog();

    } catch (error) {
        console.error('Error sharing NFT access:', error);
        // Show error in the status
        const statusElement = document.querySelector('.tx-state.pending');
        if (statusElement) {
            statusElement.className = 'tx-state error';
            statusElement.textContent = 'Error: ' + error.message;
        }
    }
}

// Add these functions to handle NFT deletion
function showDeleteConfirmation(nftAddress, nftName) {
    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    document.body.appendChild(overlay);

    // Create confirmation dialog
    const dialog = document.createElement('div');
    dialog.className = 'delete-dialog window';
    dialog.innerHTML = `
        <div class="title-bar">
            <div class="title-bar-text">Confirm Delete</div>
            <div class="title-bar-controls">
                <button aria-label="Close" onclick="window.closeDeleteDialog()"></button>
            </div>
        </div>
        <div class="window-body">
            <p>Are you sure you want to delete "${nftName}"?</p>
            <p class="warning-text">This action cannot be undone!</p>
            <div class="dialog-buttons">
                <button class="btn" onclick="window.closeDeleteDialog()">Cancel</button>
                <button class="btn delete-confirm-btn" onclick="window.deleteNFT('${nftAddress}')">Delete</button>
            </div>
        </div>
    `;
    document.body.appendChild(dialog);
}

function closeDeleteDialog() {
    const dialog = document.querySelector('.delete-dialog');
    const overlay = document.querySelector('.overlay');
    if (dialog) dialog.remove();
    if (overlay) overlay.remove();
}

async function deleteNFT(nftAddress) {
    try {
        // Show status in the dialog
        const dialogBody = document.querySelector('.delete-dialog .window-body');
        const statusDiv = document.createElement('div');
        statusDiv.className = 'transaction-status';
        statusDiv.innerHTML = `
            <div id="deleteStatus" class="tx-status">
                <span class="tx-label">Deleting NFT:</span>
                <span class="tx-state waiting">Preparing transaction...</span>
            </div>
        `;
        dialogBody.appendChild(statusDiv);

        // Get the transaction data from the server
        const response = await fetch('/api/prepare-nft-delete', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                nftAddress,
                userAddress: window.userAddress
            })
        });

        const data = await response.json();
        if (!data.success) throw new Error(data.error);

        // Update status
        window.updateTransactionStatus('deleteStatus', 'pending', 'Waiting for approval...');

        // Send the transaction
        const tx = await window.web3.eth.sendTransaction({
            ...data.transaction,
            from: window.userAddress
        });

        // Wait for transaction confirmation
        await window.waitForTransaction(tx.transactionHash, 'deleteStatus');

        // Update status and refresh assets
        window.updateTransactionStatus('deleteStatus', 'success', 'NFT deleted successfully!');
        await new Promise(resolve => setTimeout(resolve, 2000));
        await window.fetchAndDisplayAssets();
        closeDeleteDialog();

    } catch (error) {
        console.error('Error deleting NFT:', error);
        window.updateTransactionStatus('deleteStatus', 'error', 'Error: ' + error.message);
    }
}


// Export functions and variables
window.assetsUpdateInterval = assetsUpdateInterval;
window.selectedNFTForSharing = selectedNFTForSharing;
window.fetchAndDisplayAssets = fetchAndDisplayAssets;
window.showShareDialog = showShareDialog;
window.closeShareDialog = closeShareDialog;
window.toggleFriendSelection = toggleFriendSelection;
window.shareAccess = shareAccess;
window.showDeleteConfirmation = showDeleteConfirmation;
window.closeDeleteDialog = closeDeleteDialog;
window.deleteNFT = deleteNFT;
window.openAsset = openAsset;
window.waitForTransaction = waitForTransaction;
window.updateTransactionStatus = updateTransactionStatus;
