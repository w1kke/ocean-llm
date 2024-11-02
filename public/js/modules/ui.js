// UI and message management module
let ipfsUrl = null;

function addMessage(content, isUser = false) {
    const messagesDiv = document.getElementById('messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isUser ? 'user-message' : 'ai-message'}`;
    messageDiv.textContent = content;
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
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

// Export functions and variables
window.ipfsUrl = ipfsUrl;
window.addMessage = addMessage;
window.handleFileUpload = handleFileUpload;

// Add event listeners
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('fileInput').addEventListener('change', handleFileUpload);
    document.getElementById('chatInput').addEventListener('keypress', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            window.createNft();
        }
    });
});
