// Friends list management module
let friends = [];

function saveFriends() {
    localStorage.setItem(`friends_${window.userAddress}`, JSON.stringify(friends));
    window.friends = friends; // Update global reference
}

function loadFriends() {
    const savedFriends = localStorage.getItem(`friends_${window.userAddress}`);
    friends = savedFriends ? JSON.parse(savedFriends) : [];
    window.friends = friends; // Update global reference
    renderFriendsList();
}

function renderFriendsList() {
    const friendsList = document.getElementById('friendsList');
    friendsList.innerHTML = '';
    
    if (friends.length === 0) {
        friendsList.innerHTML = '<div class="friend-item">No friends added yet</div>';
        return;
    }
    
    friends.forEach((friend, index) => {
        const friendElement = document.createElement('div');
        friendElement.className = 'friend-item';
        friendElement.innerHTML = `
            <span class="friend-address">${friend.slice(0, 6)}...${friend.slice(-4)}</span>
            <button class="remove-friend" onclick="window.removeFriend(${index})">×</button>
        `;
        friendsList.appendChild(friendElement);
    });
}

function addFriend() {
    const addressInput = document.getElementById('friendAddress');
    const address = addressInput.value.trim();
    
    if (!window.isValidEthereumAddress(address)) {
        alert('Please enter a valid Ethereum address');
        return;
    }
    
    if (address === window.userAddress) {
        alert('You cannot add your own address');
        return;
    }
    
    if (friends.includes(address)) {
        alert('This address is already in your friends list');
        return;
    }
    
    friends.push(address);
    saveFriends();
    renderFriendsList();
    addressInput.value = '';
}

function removeFriend(index) {
    friends.splice(index, 1);
    saveFriends();
    renderFriendsList();
}

// Export functions and variables
window.friends = friends;
window.saveFriends = saveFriends;
window.loadFriends = loadFriends;
window.renderFriendsList = renderFriendsList;
window.addFriend = addFriend;
window.removeFriend = removeFriend;

// Add event listeners
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('addFriendBtn').addEventListener('click', addFriend);
    document.getElementById('friendAddress').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            addFriend();
        }
    });
});
