// Transaction management module

function updateTransactionStatus(id, status, message) {
    const statusElement = document.querySelector(`#${id} .tx-state`);
    statusElement.textContent = message;
    statusElement.className = `tx-state ${status}`;
}

async function waitForTransaction(txHash, statusId) {
    updateTransactionStatus(statusId, 'pending', 'Waiting for confirmation...');
    let confirmations = 0;
    
    while (confirmations < 1) {
        try {
            const receipt = await window.web3.eth.getTransactionReceipt(txHash);
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

// Export functions
window.updateTransactionStatus = updateTransactionStatus;
window.waitForTransaction = waitForTransaction;
