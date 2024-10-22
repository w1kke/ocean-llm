document.addEventListener('DOMContentLoaded', function () {
    const walletConnectBtn = document.getElementById('walletConnectBtn');

    walletConnectBtn.onclick = async function () {
        if (typeof window.ethereum !== 'undefined') {
            try {
                const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
                const address = accounts[0];
                console.log('Connected account:', address);
                walletConnectBtn.textContent = `Connected: ${address.substring(0, 6)}...${address.substring(38)}`;
                walletConnectBtn.disabled = true;
            } catch (error) {
                console.error('Error connecting to MetaMask:', error);
                alert('An error occurred while connecting to MetaMask.');
            }
        } else {
            alert('Please install MetaMask to use this feature.');
        }
    };
});