// NFT Access Information Module

async function showNFTAccessWindow() {
    if (!window.userAddress) {
        alert('Please connect your wallet first');
        return;
    }

    // Create a new window
    const accessWindow = document.createElement('div');
    accessWindow.className = 'window nft-access-window';
    accessWindow.style.position = 'fixed';
    accessWindow.style.left = '50%';
    accessWindow.style.top = '50%';
    accessWindow.style.transform = 'translate(-50%, -50%)';
    accessWindow.style.zIndex = '1000';
    accessWindow.style.width = '800px';

    accessWindow.innerHTML = `
        <div class="title-bar">
            <div class="title-bar-text">NFT Access Information</div>
            <div class="title-bar-controls">
                <button aria-label="Close" onclick="this.closest('.nft-access-window').remove()"></button>
            </div>
        </div>
        <div class="window-body">
            <div id="nftAccessContent">
                <p>Loading NFT access information...</p>
            </div>
        </div>
    `;

    document.body.appendChild(accessWindow);

    try {
        // Get current chain ID
        const chainId = await window.web3.eth.getChainId();

        // Fetch NFT access information
        const response = await fetch(`/api/nft-access/${window.userAddress}/${chainId}`);
        const data = await response.json();

        if (!data.success) {
            throw new Error(data.error || 'Failed to fetch NFT access information');
        }

        const contentDiv = accessWindow.querySelector('#nftAccessContent');

        if (!data.accessibleNfts || data.accessibleNfts.length === 0) {
            contentDiv.innerHTML = `
                <p>No NFT access rights found for this wallet.</p>
            `;
            return;
        }

        // Log the raw NFT data for debugging
        console.log('Raw NFT data:', data.accessibleNfts);

        // Display the NFTs in a grid layout similar to assets
        contentDiv.innerHTML = `
            <div class="field-row" style="margin-bottom: 10px;">
                <p>NFTs you have access to through Ocean Protocol (${data.accessibleNfts.length} total):</p>
            </div>
            
            <div class="nft-access-grid">
                ${data.accessibleNfts.map((nft, index) => {
            // Log each NFT processing attempt
            console.log(`Processing NFT ${index + 1}/${data.accessibleNfts.length}:`, nft);

            try {
                const createdDate = nft.created ? new Date(nft.created).toLocaleString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                }) : 'N/A';

                // Log successful NFT card creation
                console.log(`Successfully created card for NFT ${index + 1}`);

                return `
    <div class="asset-card window">
        <div class="title-bar">
            <div class="title-bar-text">${nft.name || nft.symbol || 'Unnamed NFT'}</div>
            <div class="title-bar-controls">
                <button aria-label="Minimize"></button>
                <button aria-label="Maximize"></button>
                <button aria-label="Close"></button>
            </div>
        </div>
        <div class="window-body">
            <div class="asset-preview">
                <img src="${nft.previewImageUrl || '/images/ImageNotFound.png'}" alt="NFT Preview" class="asset-image">
            </div>
            <p><strong>Description:</strong> ${nft.description || 'No description available'}</p>
            <p><strong>Author:</strong> ${nft.author || 'Unknown'}</p>
            <p><strong>Created:</strong> ${createdDate}</p>
            <p><strong>NFT Address:</strong> ${nft.nftAddress}</p>
            <p><strong>Datatoken Address:</strong> ${nft.datatokenAddress}</p>
            <p><strong>Current Balance:</strong> ${nft.currentBalance} tokens</p>
            <p><strong>Access Status:</strong> ${parseFloat(nft.currentBalance) > 0 ? 'Has Access Token' : 'Used Access Token'}</p>
            ${nft.tags ? `<p><strong>Tags:</strong> ${nft.tags.join(', ')}</p>` : ''}
            <div class="button-bar">
                <button onclick="window.openAccessAsset('${nft.nftAddress}', '${nft.datatokenAddress}')" class="open-btn">
                    Open
                </button>
                <button onclick="window.open('https://market.oceanprotocol.com/asset/${nft.did}', '_blank')" class="market-btn">
                    View in Ocean Market
                </button>
            </div>
        </div>
    </div>
`;
            } catch (error) {
                // Log any errors in card creation
                console.error(`Error creating card for NFT ${index + 1}:`, error);
                return `
                            <div class="asset-card window">
                                <div class="title-bar">
                                    <div class="title-bar-text">Error Loading NFT</div>
                                </div>
                                <div class="window-body">
                                    <p>Error loading NFT information: ${error.message}</p>
                                    <p>NFT Address: ${nft.nftAddress || 'Unknown'}</p>
                                </div>
                            </div>
                        `;
            }
        }).join('')}
            </div>
        `;

        // Log final rendered count
        const renderedCards = accessWindow.querySelectorAll('.asset-card');
        console.log(`Rendered ${renderedCards.length} NFT cards out of ${data.accessibleNfts.length} total NFTs`);

    } catch (error) {
        console.error('Error fetching NFT access:', error);
        const contentDiv = accessWindow.querySelector('#nftAccessContent');
        contentDiv.innerHTML = `
            <p class="error">Error: ${error.message}</p>
        `;
    }
}




async function openAccessAsset(nftAddress, datatokenAddress) {
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
                        <div id="openAccessAssetStatus" class="tx-status">
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
        window.updateTransactionStatus('openAccessAssetStatus', 'pending', 'Preparing consume transaction...');
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

        if (consumeData.hasValidOrder && consumeData.orderTxId) {
            orderTxId = consumeData.orderTxId;
            console.log(`Using existing order transaction ID: ${orderTxId}`);
            window.updateTransactionStatus('openAccessAssetStatus', 'pending', 'Using existing access...');
        } else {
            // Execute transactions in sequence for new purchase
            for (const tx of consumeData.transactions) {
                window.updateTransactionStatus('openAccessAssetStatus', 'pending', tx.message);

                const txHash = await window.ethereum.request({
                    method: 'eth_sendTransaction',
                    params: [{
                        ...tx.data,
                        from: window.userAddress
                    }]
                });

                // Updated to include statusId parameter
                const receipt = await window.waitForTransaction(txHash, 'openAccessAssetStatus');
                console.log(`Transaction confirmed:`, receipt);

                if (!receipt.status) {
                    throw new Error(`Transaction failed: ${txHash}`);
                }

                if (tx === consumeData.transactions[consumeData.transactions.length - 1]) {
                    orderTxId = receipt.transactionHash;
                }
            }
        }

        if (!orderTxId) {
            throw new Error('Failed to get order transaction ID');
        }

        // Get download URL
        window.updateTransactionStatus('openAccessAssetStatus', 'pending', 'Getting download URL...');
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
        window.updateTransactionStatus('openAccessAssetStatus', 'success', 'Download started!');
        setTimeout(() => statusDiv.remove(), 2000);

    } catch (error) {
        console.error('Error opening asset:', error);
        const statusElement = document.querySelector('#openAccessAssetStatus .tx-state');
        if (statusElement) {
            statusElement.className = 'tx-state error';
            statusElement.textContent = 'Error: ' + error.message;
        }
        setTimeout(() => document.querySelector('.status-overlay')?.remove(), 3000);
    }
}


// Export functions
window.showNFTAccessWindow = showNFTAccessWindow;
window.openAccessAsset = openAccessAsset;
window.waitForTransaction = waitForTransaction;
window.updateTransactionStatus = updateTransactionStatus;