const { ethers } = require('ethers');

// Minimal ERC20 ABI to get token information
const ERC20_ABI = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)"
];

// Token Tracker specific ABI
const TOKEN_TRACKER_ABI = [
    "function getDispensers() view returns (address[])"
];

class TokenFetcher {
    constructor(provider, dispenserAddress) {
        this.provider = provider;
        this.dispenserAddress = dispenserAddress;
    }

    async isDatatoken(tokenAddress) {
        try {
            // First check if it's a contract
            const code = await this.provider.getCode(tokenAddress);
            if (code === '0x') return false; // Not a contract

            const contract = new ethers.Contract(tokenAddress, TOKEN_TRACKER_ABI, this.provider);
            
            try {
                // Get dispensers from the contract
                const dispensers = await contract.getDispensers();
                
                // Check if the Ocean Protocol dispenser address is in the returned dispensers
                return dispensers && dispensers.some(dispenser => 
                    dispenser.toLowerCase() === this.dispenserAddress.toLowerCase()
                );
            } catch (error) {
                // If getDispensers() fails, it's not a datatoken
                return false;
            }
        } catch (error) {
            console.error(`Error checking if ${tokenAddress} is a datatoken:`, error);
            return false;
        }
    }

    async getTokenBalance(tokenAddress, walletAddress) {
        const contract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
        try {
            const [balance, name, symbol, decimals] = await Promise.all([
                contract.balanceOf(walletAddress),
                contract.name(),
                contract.symbol(),
                contract.decimals()
            ]);

            return {
                address: tokenAddress,
                name,
                symbol,
                balance: balance.toString(),
                decimals: decimals
            };
        } catch (error) {
            console.error(`Error getting token info for ${tokenAddress}:`, error);
            return null;
        }
    }

    async getTokensAndTransfers(walletAddress) {
        try {
            // Get token transfer events to this wallet (both in and out)
            const filter = {
                topics: [
                    ethers.utils.id("Transfer(address,address,uint256)"),
                    null,
                    ethers.utils.hexZeroPad(walletAddress, 32)
                ]
            };

            // Query the last 10000 blocks for transfer events
            const currentBlock = await this.provider.getBlockNumber();
            const fromBlock = Math.max(0, currentBlock - 10000);
            const events = await this.provider.getLogs({
                ...filter,
                fromBlock
            });

            // Get unique token addresses from transfer events
            const tokenAddresses = new Set(events.map(event => event.address));
            
            // Check each token if it's a datatoken and get its balance
            const tokens = await Promise.all(
                Array.from(tokenAddresses).map(async (tokenAddress) => {
                    const isDatatoken = await this.isDatatoken(tokenAddress);
                    if (isDatatoken) {
                        return await this.getTokenBalance(tokenAddress, walletAddress);
                    }
                    return null;
                })
            );

            // Filter out null values and format the response
            const datatokens = tokens.filter(token => token !== null);

            return {
                datatokens,
                message: datatokens.length > 0 
                    ? `Found ${datatokens.length} datatokens`
                    : 'No datatokens found'
            };
        } catch (error) {
            console.error('Error in getTokensAndTransfers:', error);
            throw error;
        }
    }
}

module.exports = TokenFetcher;
