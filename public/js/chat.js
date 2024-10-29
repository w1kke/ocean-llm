let web3;
let userAddress;

document.addEventListener('DOMContentLoaded', function () {
    const createNftBtn = document.getElementById('createNftBtn');
    const walletConnectBtn = document.getElementById('walletConnectBtn');
    const nftResult = document.getElementById('nftResult');
    const chatInput = document.getElementById('chatInput');

    walletConnectBtn.onclick = connectWallet;
    createNftBtn.onclick = createAndPublishNFT;

    async function connectWallet() {
        if (typeof window.ethereum !== 'undefined') {
            try {
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

            const response = await fetch('/api/create-and-publish-nft', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt, userAddress })
            });

            const data = await response.json();
            if (!data.success) throw new Error(data.error);

            const signedTx = await web3.eth.sendTransaction({
                from: userAddress,
                to: data.txData.to,
                data: data.txData.data
            });

            const txReceipt = await waitForTransactionReceipt(signedTx.transactionHash);
            const nftLog = txReceipt.logs.find(log => log.topics[0] === web3.utils.sha3("Transfer(address,address,uint256)"));
            if (!nftLog) throw new Error('NFT creation event not found in transaction logs.');

            const nftAddress = `0x${nftLog.address.slice(-40)}`;
            nftResult.innerHTML = `<div class="alert alert-success">Transaction Hash: ${txReceipt.transactionHash}</div>`;

            const chainId = await web3.eth.getChainId();

            // Step 2: Fetch populated `setMetadata` transaction from the backend
            const updateResponse = await fetch('/api/encrypt-metadata', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    nftAddress,
                    metadata: { ...data.metadata, created: new Date().toISOString() },
                    chainId
                })
            });

            const updateData = await updateResponse.json();
            if (!updateData.success) throw new Error(updateData.error);

            // Step 3: User signs the populated `setMetadata` transaction
            console.log('Signing setMetadata transaction...');
            const signedSetMetadataTx = await web3.eth.sendTransaction(updateData.populatedTransaction);

            nftResult.innerHTML += `<div class="alert alert-success">Metadata updated successfully. TX: ${signedSetMetadataTx.transactionHash}</div>`;
        } catch (error) {
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
