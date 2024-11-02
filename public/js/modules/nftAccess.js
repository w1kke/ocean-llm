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
                                        <img src="${nft.previewImageUrl || '/images/icq-flower.png'}" alt="NFT Preview" class="asset-image">
                                    </div>
                                    <p><strong>Description:</strong> ${nft.description || 'No description available'}</p>
                                    <p><strong>Author:</strong> ${nft.author || 'Unknown'}</p>
                                    <p><strong>Created:</strong> ${createdDate}</p>
                                    <p><strong>NFT Address:</strong> ${nft.nftAddress}</p>
                                    <p><strong>Current Balance:</strong> ${nft.currentBalance} tokens</p>
                                    <p><strong>Access Status:</strong> ${parseFloat(nft.currentBalance) > 0 ? 'Has Access Token' : 'Used Access Token'}</p>
                                    ${nft.tags ? `<p><strong>Tags:</strong> ${nft.tags.join(', ')}</p>` : ''}
                                    <div class="button-bar">
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

// Export functions
window.showNFTAccessWindow = showNFTAccessWindow;
