document.addEventListener('DOMContentLoaded', function () {
    const chatInput = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendBtn');
    const messages = document.getElementById('messages');

    sendBtn.onclick = async function () {
        const message = chatInput.value.trim();
        if (message) {
            addMessage('You', message);
            try {
                const response = await fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message })
                });
                const data = await response.json();
                addMessage('AI', data.response);
                chatInput.value = '';
            } catch (error) {
                console.error('Error sending message:', error);
                addMessage('System', 'An error occurred while sending your message.');
            }
        }
    };

    function addMessage(sender, text) {
        const messageElement = document.createElement('div');
        messageElement.innerHTML = `<strong>${sender}:</strong> ${text}`;
        messages.appendChild(messageElement);
        messages.scrollTop = messages.scrollHeight;
    }
});