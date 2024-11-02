// Initialize chat functionality
document.addEventListener('DOMContentLoaded', () => {
    const chatInput = document.getElementById('chatInput');
    const createNftBtn = document.getElementById('createNftBtn');
    const walletConnectBtn = document.getElementById('walletConnectBtn');
    const fileInput = document.getElementById('fileInput');
    
    // Set up wallet connection
    walletConnectBtn.addEventListener('click', window.connectWallet);
    
    // Handle NFT creation
    createNftBtn.addEventListener('click', async () => {
        const prompt = chatInput.value.trim();
        if (!prompt) {
            alert('Please enter a description for your NFT');
            return;
        }
        
        const file = fileInput.files[0];
        if (!file) {
            alert('Please select a file to upload');
            return;
        }
        
        try {
            await window.createNft(prompt, file);
        } catch (error) {
            console.error('Error creating NFT:', error);
            alert('Failed to create NFT: ' + error.message);
        }
    });
});
