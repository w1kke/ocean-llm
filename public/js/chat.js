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
