// NFT creation and management module

async function createNft(prompt, file) {
    if (!window.userAddress) {
        alert('Please connect your wallet first');
        return;
    }

    if (!prompt) {
        alert('Please enter a description for your NFT');
        return;
    }

    if (!file) {
        alert('Please select a file to upload');
        return;
    }

    window.addMessage(prompt, true);
    document.getElementById('createNftBtn').disabled = true;

    try {
        document.getElementById('nftResult').textContent = '🤖 AI is working... Generating metadata...';

        // Then create the NFT with the IPFS URL
        const response = await fetch('/api/create-and-publish-nft', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                prompt,
                userAddress: window.userAddress,
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
                <p><strong>Main Asset:</strong> ${ipfsUrl}</p>
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
            <button onclick="window.proceedWithNftCreation()" class="btn confirm-btn">✅ Create NFT</button>
            <button onclick="location.reload()" class="btn cancel-btn">🔄 Start Over</button>
        `;
        
        const input = document.getElementById('chatInput');
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
    window.updateTransactionStatus('tx1Status', 'waiting', 'Waiting to start...');
    window.updateTransactionStatus('tx2Status', 'waiting', 'Waiting to start...');
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
            from: window.userAddress,
            data: createData.txData.data,
            gas: window.web3.utils.numberToHex(gasLimitValue)
        };

        window.updateTransactionStatus('tx1Status', 'pending', 'Waiting for approval...');
        console.log('Sending first transaction:', txToSend);
        const tx = await window.web3.eth.sendTransaction(txToSend);
        console.log('NFT Creation Transaction:', tx);

        // Wait for the first transaction to be mined
        const receipt = await window.waitForTransaction(tx.transactionHash, 'tx1Status');
        console.log('receipt logs:', receipt.logs);
        const nftAddress = receipt.logs[2].address; // The third log contains the NFT address
        const datatokenAddress = receipt.logs[7].address;

        console.log(nftAddress);
        console.log(datatokenAddress);

        document.getElementById('nftResult').textContent = 'Preparing metadata encryption...';

        // Second API call to encrypt metadata
        const chainId = await window.web3.eth.getChainId();
        const encryptResponse = await fetch('/api/encrypt-metadata', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                nftAddress,
                datatokenAddress,
                metadata: createData.metadata,
                chainId,
                publisherAddress: window.userAddress
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
            from: window.userAddress,
            data: encryptData.transaction.data,
            gas: window.web3.utils.numberToHex(gasLimitValue2)
        };

        window.updateTransactionStatus('tx2Status', 'pending', 'Waiting for approval...');
        console.log('Sending second transaction:', tx2ToSend);
        const tx2 = await window.web3.eth.sendTransaction(tx2ToSend);
        console.log('Metadata Transaction:', tx2);

        // Wait for the second transaction to be mined
        await window.waitForTransaction(tx2.transactionHash, 'tx2Status');

        document.getElementById('nftResult').textContent = `NFT created successfully! Address: ${nftAddress}`;
        
        // Refresh the assets display
        await window.fetchAndDisplayAssets();

    } catch (error) {
        console.error('Error:', error);
        document.getElementById('nftResult').textContent = 'Error: ' + error.message;
    }
}

// Export functions
window.createNft = createNft;
