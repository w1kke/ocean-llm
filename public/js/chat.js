let web3;
let userAddress;

document.addEventListener('DOMContentLoaded', function () {
    const createNftBtn = document.getElementById('createNftBtn');
    const walletConnectBtn = document.getElementById('walletConnectBtn');
    const nftResult = document.getElementById('nftResult');
    const chatInput = document.getElementById('chatInput');
    const messages = document.getElementById('messages');

    // Add title bar button functionality
    document.querySelectorAll('.title-bar-controls button').forEach(button => {
        button.addEventListener('mousedown', function() {
            this.style.borderColor = 'var(--win-darker) var(--win-lighter) var(--win-lighter) var(--win-darker)';
        });
        button.addEventListener('mouseup', function() {
            this.style.borderColor = 'var(--win-lighter) var(--win-darker) var(--win-darker) var(--win-lighter)';
        });
        button.addEventListener('mouseleave', function() {
            this.style.borderColor = 'var(--win-lighter) var(--win-darker) var(--win-darker) var(--win-lighter)';
        });
    });

    function showSystemAlert(message) {
        const alertBox = document.createElement('div');
        alertBox.className = 'system-alert';
        alertBox.innerHTML = `
            <div class="title-bar">
                <div class="title-bar-text">Ocean AI NFT Creator</div>
                <div class="title-bar-controls">
                    <button aria-label="Close"></button>
                </div>
            </div>
            <div class="window-body">
                <p>${message}</p>
                <div class="button-row">
                    <button class="btn">OK</button>
                </div>
            </div>
        `;
        document.body.appendChild(alertBox);

        const closeBtn = alertBox.querySelector('button');
        closeBtn.onclick = () => alertBox.remove();

        // Center the alert box
        alertBox.style.position = 'fixed';
        alertBox.style.top = '50%';
        alertBox.style.left = '50%';
        alertBox.style.transform = 'translate(-50%, -50%)';
    }

    function addMessage(text, type = 'info') {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        messageDiv.textContent = text;
        messages.appendChild(messageDiv);
        messages.scrollTop = messages.scrollHeight;
    }

    walletConnectBtn.onclick = connectWallet;
    createNftBtn.onclick = createAndPublishNFT;

    // Enter key in input triggers create button if enabled
    chatInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter' && !createNftBtn.disabled) {
            createAndPublishNFT();
        }
    });

    async function connectWallet() {
        if (typeof window.ethereum !== 'undefined') {
            try {
                await window.ethereum.request({ method: 'eth_requestAccounts' });
                web3 = new Web3(window.ethereum);
                const accounts = await web3.eth.getAccounts();
                userAddress = accounts[0];
                walletConnectBtn.textContent = `Connected: ${userAddress.substring(0, 6)}...${userAddress.slice(-4)}`;
                createNftBtn.disabled = false;
                addMessage('Wallet connected successfully', 'success');
            } catch (error) {
                console.error('Error connecting to MetaMask:', error);
                showSystemAlert('Please ensure MetaMask is installed and configured.');
                addMessage('Failed to connect wallet', 'error');
            }
        } else {
            showSystemAlert('MetaMask is required for this feature.');
            addMessage('MetaMask not detected', 'error');
        }
    }

    async function createAndPublishNFT() {
        if (!userAddress) {
            showSystemAlert('Please connect your wallet');
            return;
        }
        const prompt = chatInput.value.trim();
        if (!prompt) {
            showSystemAlert('Please enter a description');
            return;
        }
    
        try {
            addMessage(`Creating NFT: "${prompt}"`, 'info');
            nftResult.innerHTML = `<div class="alert alert-info">Creating and publishing NFT...</div>`;
    
            // Step 1: Fetch metadata and transaction data from the backend
            const response = await fetch('/api/create-and-publish-nft', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt, userAddress })
            });
    
            const data = await response.json();
            if (!data.success) throw new Error(data.error);
    
            addMessage('Please confirm the transaction in MetaMask', 'info');
            const signedTx = await web3.eth.sendTransaction({
                from: userAddress,
                to: data.txData.to,
                data: data.txData.data
            });
    
            addMessage('Transaction submitted, waiting for confirmation...', 'info');
            const txReceipt = await waitForTransactionReceipt(signedTx.transactionHash);
            const nftLog = txReceipt.logs.find(log => log.topics[0] === web3.utils.sha3("Transfer(address,address,uint256)"));
            if (!nftLog) throw new Error('NFT creation event not found in transaction logs.');
    
            const nftAddress = `0x${nftLog.address.slice(-40)}`;
            nftResult.innerHTML = `<div class="alert alert-success">Transaction Hash: ${txReceipt.transactionHash}</div>`;
            addMessage('NFT created successfully', 'success');
    
            const chainId = await web3.eth.getChainId();
    
            // Step 2: Call backend to populate setMetadata transaction
            addMessage('Updating metadata...', 'info');
            const updateResponse = await fetch('/api/encrypt-metadata', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    nftAddress,
                    metadata: { ...data.metadata, created: new Date().toISOString() },
                    chainId,
                    publisherAddress: userAddress
                })
            });
    
            const updateData = await updateResponse.json();
            if (!updateData.success) throw new Error(updateData.error);
    
            const populatedTx = updateData.transaction;
            if (!populatedTx || !populatedTx.to || !populatedTx.data) {
                throw new Error('Invalid transaction data from backend.');
            }
    
            addMessage('Please confirm the metadata transaction', 'info');
            const signedSetMetadataTx = await web3.eth.sendTransaction({
                from: userAddress,
                to: populatedTx.to,
                data: populatedTx.data
            });
    
            addMessage('Metadata updated successfully', 'success');
            nftResult.innerHTML += `<div class="alert alert-success">Metadata updated successfully. TX: ${signedSetMetadataTx.transactionHash}</div>`;
            
            // Clear input after successful creation
            chatInput.value = '';
        } catch (error) {
            addMessage(`Error: ${error.message}`, 'error');
            nftResult.innerHTML = `<div class="alert alert-danger">Error: ${error.message}</div>`;
            console.error('Error during NFT creation and metadata update:', error);
        }
    }

    async function waitForTransactionReceipt(hash) {
        let receipt = null;
        while (!receipt) {
            receipt = await web3.eth.getTransactionReceipt(hash);
            if (!receipt) await new Promise(resolve => setTimeout(resolve, 3000));
        }
        return receipt;
    }
});
