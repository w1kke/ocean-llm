let web3;
let userAddress;

<<<<<<< HEAD
document.addEventListener('DOMContentLoaded', function() {
    const chatInput = document.getElementById('chatInput');
    const createNftBtn = document.getElementById('createNftBtn');
    const messagesDiv = document.getElementById('messages');
    const nftResult = document.getElementById('nftResult');
    const walletConnectBtn = document.getElementById('walletConnectBtn');
=======
document.addEventListener('DOMContentLoaded', function () {
    const createNftBtn = document.getElementById('createNftBtn');
    const walletConnectBtn = document.getElementById('walletConnectBtn');
    const nftResult = document.getElementById('nftResult');
    const chatInput = document.getElementById('chatInput');
>>>>>>> 80a8564 (update)

    walletConnectBtn.onclick = connectWallet;
    createNftBtn.onclick = createAndPublishNFT;

    async function connectWallet() {
        if (typeof window.ethereum !== 'undefined') {
            try {
<<<<<<< HEAD
                await window.ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: '0xaa36a7' }], // Sepolia
                });
                web3 = new Web3(window.ethereum);
                const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
                userAddress = accounts[0];
                walletConnectBtn.textContent = `Connected: ${userAddress.substring(0, 6)}...${userAddress.substring(38)}`;
                walletConnectBtn.disabled = true;
                createNftBtn.disabled = false;
            } catch (error) {
                console.error('Error connecting to MetaMask:', error);
                alert('Please make sure you have MetaMask installed and configured for Sepolia network.');
            }
        } else {
            alert('Please install MetaMask to use this feature.');
        }
    }

    async function createAndPublishNFT() {
        if (!userAddress) {
            alert('Please connect your wallet first');
            return;
        }

        const prompt = chatInput.value.trim();
        if (!prompt) {
            alert('Please enter an NFT description');
            return;
        }

        try {
            createNftBtn.disabled = true;
            createNftBtn.textContent = 'Creating NFT...';
            
            // Step 1: Create tokens
            nftResult.innerHTML = '<div class="alert alert-info">Step 1/3: Creating tokens...</div>';
            
            const response = await fetch('/api/create-and-publish-nft', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt, userAddress })
            });

            const data = await response.json();
            if (!data.success) {
                throw new Error(data.error || 'Unknown error occurred');
            }

            // Step 2: Sign and send the transaction
            nftResult.innerHTML = '<div class="alert alert-info">Step 2/3: Signing transaction...</div>';
            
            const signedTx = await web3.eth.sendTransaction(data.unsignedTx);
            const txReceipt = await web3.eth.getTransactionReceipt(signedTx.transactionHash);

            // Extract NFT and datatoken addresses from transaction logs
            const nftAddress = txReceipt.logs[0].address; // First event should be NFT creation
            const datatokenAddress = txReceipt.logs[1].address; // Second event should be datatoken creation

            // Step 3: Set NFT metadata
            nftResult.innerHTML = '<div class="alert alert-info">Step 3/3: Setting metadata...</div>';
            
            const metadataResponse = await fetch('/api/set-nft-metadata', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userAddress,
                    nftAddress,
                    datatokenAddress,
                    metadata: data.metadata
                })
            });

            const metadataResult = await metadataResponse.json();
            if (!metadataResult.success) {
                throw new Error(metadataResult.error || 'Failed to set metadata');
            }

            // Success!
            nftResult.innerHTML = `
                <div class="alert alert-success">
                    <h4>NFT Created Successfully!</h4>
                    <p><strong>Name:</strong> ${data.metadata.name}</p>
                    <p><strong>Description:</strong> ${data.metadata.description}</p>
                    <p><strong>Tags:</strong> ${data.metadata.tags.join(', ')}</p>
                    <p><strong>NFT Address:</strong> <a href="https://sepolia.etherscan.io/address/${nftAddress}" target="_blank">${nftAddress}</a></p>
                    <p><strong>Datatoken Address:</strong> <a href="https://sepolia.etherscan.io/address/${datatokenAddress}" target="_blank">${datatokenAddress}</a></p>
                    <p><strong>Transaction Hash:</strong> <a href="https://sepolia.etherscan.io/tx/${signedTx.transactionHash}" target="_blank">${signedTx.transactionHash}</a></p>
                </div>
            `;
        } catch (error) {
            console.error('Error creating NFT:', error);
            nftResult.innerHTML = `
                <div class="alert alert-danger">
                    Error creating NFT: ${error.message}
                </div>
            `;
        } finally {
            createNftBtn.disabled = false;
            createNftBtn.textContent = 'Create NFT';
        }
=======
                await window.ethereum.request({ method: 'eth_requestAccounts' });
                web3 = new Web3(window.ethereum);
                const accounts = await web3.eth.getAccounts();
                userAddress = accounts[0];
                walletConnectBtn.textContent = `Connected: ${userAddress.substring(0, 6)}...${userAddress.slice(-4)}`;
                createNftBtn.disabled = false;
            } catch (error) {
                console.error('Error connecting to MetaMask:', error);
                alert('Please ensure MetaMask is installed and configured.');
            }
        } else {
            alert('MetaMask is required for this feature.');
        }
>>>>>>> 80a8564 (update)
    }

    async function createAndPublishNFT() {
        if (!userAddress) {
            alert('Please connect your wallet');
            return;
        }
        const prompt = chatInput.value.trim();
        if (!prompt) {
            alert('Please enter a description');
            return;
        }

        try {
            nftResult.innerHTML = `<div class="alert alert-info">Creating and publishing NFT...</div>`;

            // Request backend to generate NFT creation data
            const response = await fetch('/api/create-and-publish-nft', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt, userAddress })
            });

            const data = await response.json();
            if (!data.success) throw new Error(data.error);

            // Sign and send transaction for NFT creation
            const signedTx = await web3.eth.sendTransaction({
                from: userAddress,
                to: data.txData.to,
                data: data.txData.data
            });

            // Get NFT and datatoken addresses from transaction receipt logs
            const txReceipt = await web3.eth.getTransactionReceipt(signedTx.transactionHash);
            const nftAddress = txReceipt.logs[3].address;

            nftResult.innerHTML = `<div class="alert alert-success">Transaction Hash: ${txReceipt.transactionHash}</div>`;

            // Update backend with NFT address and metadata
            console.log("Sending metadata update request with:", {
                nftAddress,
                metadata: data.metadata,
                userAddress
            });

            const updateResponse = await fetch('/api/update-nft-metadata', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nftAddress, metadata: data.metadata, userAddress })
            });

            const updateData = await updateResponse.json();
            if (!updateData.success) throw new Error(updateData.error);

            nftResult.innerHTML += `<div class="alert alert-success">Metadata updated successfully for NFT: ${nftAddress}</div>`;
        } catch (error) {
            nftResult.innerHTML = `<div class="alert alert-danger">Error: ${error.message}</div>`;
            console.error('Error during NFT creation and metadata update:', error);
        }
    }
});
