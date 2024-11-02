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
    accessWindow.style.width = '600px';

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
        
        if (data.accessibleNfts.length === 0) {
            contentDiv.innerHTML = `
                <p>No NFT access rights found for this wallet.</p>
            `;
            return;
        }

        // Separate NFTs by access type
        const availableNfts = data.accessibleNfts.filter(nft => nft.accessType === 'Available');
        const spentNfts = data.accessibleNfts.filter(nft => nft.accessType === 'Spent');

        // Display the NFTs
        contentDiv.innerHTML = `
            <div class="field-row" style="margin-bottom: 10px;">
                <p>NFTs you have access to through Ocean Protocol:</p>
            </div>
            
            ${availableNfts.length > 0 ? `
                <div class="nft-section">
                    <h4>Available Tokens</h4>
                    <div class="nft-access-list">
                        ${availableNfts.map(nft => `
                            <div class="nft-access-item">
                                <p><strong>NFT Name:</strong> ${nft.name || 'Unnamed'}</p>
                                <p><strong>Symbol:</strong> ${nft.symbol || 'No Symbol'}</p>
                                <p><strong>NFT Address:</strong> ${nft.nftAddress}</p>
                                <p><strong>Current Balance:</strong> ${nft.currentBalance} tokens</p>
                                <button onclick="window.open('https://market.oceanprotocol.com/asset/${nft.did}', '_blank')" class="btn">
                                    View in Ocean Market
                                </button>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}

            ${spentNfts.length > 0 ? `
                <div class="nft-section">
                    <h4>Previously Accessed NFTs</h4>
                    <div class="nft-access-list">
                        ${spentNfts.map(nft => `
                            <div class="nft-access-item spent">
                                <p><strong>NFT Name:</strong> ${nft.name || 'Unnamed'}</p>
                                <p><strong>Symbol:</strong> ${nft.symbol || 'No Symbol'}</p>
                                <p><strong>NFT Address:</strong> ${nft.nftAddress}</p>
                                <button onclick="window.open('https://market.oceanprotocol.com/asset/${nft.did}', '_blank')" class="btn">
                                    View in Ocean Market
                                </button>
                            </div>
                        `).join('')}
                    </div>
                </div>
            ` : ''}
        `;

    } catch (error) {
        console.error('Error fetching NFT access:', error);
        const contentDiv = accessWindow.querySelector('#nftAccessContent');
        contentDiv.innerHTML = `
            <p class="error">Error: ${error.message}</p>
        `;
    }
}

// Export functions
window.showNFTAccessWindow = showNFTAccessWindow;
