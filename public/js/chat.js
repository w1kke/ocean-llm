let userAddress = null;
let web3;
let ipfsUrl = null;

function updateTransactionStatus(id, status, message) {
    const statusElement = document.querySelector(`#${id} .tx-state`);
    statusElement.textContent = message;
    statusElement.className = `tx-state ${status}`;
}

async function connectWallet() {
    if (typeof window.ethereum !== 'undefined') {
        try {
            const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
            userAddress = accounts[0];
            web3 = new Web3(window.ethereum);
            
            document.getElementById('walletConnectBtn').textContent = `Connected: ${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`;
            document.getElementById('createNftBtn').disabled = false;
            
            // Handle account changes
            window.ethereum.on('accountsChanged', function (accounts) {
                if (accounts.length === 0) {
                    userAddress = null;
                    document.getElementById('walletConnectBtn').textContent = 'Connect Wallet';
                    document.getElementById('createNftBtn').disabled = true;
                } else {
                    userAddress = accounts[0];
                    document.getElementById('walletConnectBtn').textContent = `Connected: ${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`;
                    document.getElementById('createNftBtn').disabled = false;
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

    // Reset transaction statuses
    updateTransactionStatus('tx1Status', 'waiting', 'Waiting to start...');
    updateTransactionStatus('tx2Status', 'waiting', 'Waiting to start...');

    addMessage(prompt, true);
    document.getElementById('createNftBtn').disabled = true;
    document.getElementById('nftResult').textContent = 'Creating NFT...';

    try {
        // First API call to create NFT
        const createResponse = await fetch('/api/create-and-publish-nft', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                prompt,
                userAddress,
                ipfsUrl // Include IPFS URL if a file was uploaded
            })
        });

        const createData = await createResponse.json();
        if (!createData.success) {
            throw new Error(createData.error || 'Failed to create NFT');
        }

        addMessage(JSON.stringify(createData.metadata, null, 2));

        // Sign and send the first transaction
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
        } catch (error) {
            console.error('Transaction error:', error);
            document.getElementById('nftResult').textContent = 'Transaction failed: ' + error.message;
            throw error;
        }
    } catch (error) {
        console.error('Error:', error);
        document.getElementById('nftResult').textContent = 'Error: ' + error.message;
    } finally {
        document.getElementById('createNftBtn').disabled = false;
        input.value = '';
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