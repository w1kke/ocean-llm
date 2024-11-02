const { ethers } = require('ethers');

// Minimal ERC20 ABI to get token information
const ERC20_ABI = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)"
];

// Initial contract ABI to get token list
const INITIAL_ABI = [
    "function getTokensList() view returns (address[])"
];

// Token contract ABI to check dispensers
const TOKEN_CONTRACT_ABI = [
    "function getDispensers() view returns (address[])"
];

class TokenFetcher {
    constructor(provider, dispenserAddress) {
        this.provider = provider;
        this.dispenserAddress = dispenserAddress;
    }

    async findNFTForToken(tokenAddress) {
        console.log('\n=== Analyzing Token ===');
        console.log('Initial Token Address:', tokenAddress);
        console.log('Expected Dispenser Address:', this.dispenserAddress);

        try {
            // Get contract code
            const code = await this.provider.getCode(tokenAddress);
            console.log('Contract Code Length:', code.length);
            console.log('Is Contract:', code !== '0x');

            if (code === '0x') {
                console.log('Not a contract, skipping...');
                return null;
            }

            // First try to get the tokens list
            const initialContract = new ethers.Contract(tokenAddress, INITIAL_ABI, this.provider);
            
            try {
                console.log('Checking getTokensList()...');
                const tokensList = await initialContract.getTokensList();
                console.log('Tokens List:', tokensList);

                // For each token in the list, check if it has the dispenser
                for (const nftAddress of tokensList) {
                    console.log('\nChecking token contract:', nftAddress);
                    
                    const nftContract = new ethers.Contract(
                        nftAddress,
                        TOKEN_CONTRACT_ABI,
                        this.provider
                    );

                    try {
                        const dispensers = await nftContract.getDispensers();
                        console.log('Dispensers from token contract:', dispensers);

                        // Check if our dispenser is in the list
                        const hasOceanDispenser = dispensers.some(dispenser => 
                            dispenser.toLowerCase() === this.dispenserAddress.toLowerCase()
                        );
                        console.log('Has Ocean Dispenser:', hasOceanDispenser);

                        if (hasOceanDispenser) {
                            // Get token information
                            try {
                                const erc20Contract = new ethers.Contract(nftAddress, ERC20_ABI, this.provider);
                                const [name, symbol] = await Promise.all([
                                    erc20Contract.name(),
                                    erc20Contract.symbol()
                                ]);

                                return {
                                    address: nftAddress,
                                    name,
                                    symbol,
                                    initialTokenAddress: tokenAddress
                                };
                            } catch (error) {
                                console.log('Error getting token info:', error.message);
                                return {
                                    address: nftAddress,
                                    initialTokenAddress: tokenAddress
                                };
                            }
                        }
                    } catch (error) {
                        console.log('Error checking dispensers:', error.message);
                    }
                }
            } catch (error) {
                console.log('Error getting tokens list:', error.message);
            }

            return null;
        } catch (error) {
            console.error(`Error analyzing token ${tokenAddress}:`, error);
            return null;
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
            console.log('\nFound', tokenAddresses.size, 'unique token addresses');
            
            // Find tokens for each address
            const tokens = await Promise.all(
                Array.from(tokenAddresses).map(tokenAddress => 
                    this.findNFTForToken(tokenAddress)
                )
            );

            // Filter out null values and get balances
            const validTokens = tokens.filter(token => token !== null);
            const tokensWithBalances = await Promise.all(
                validTokens.map(async (token) => {
                    const balance = await this.getTokenBalance(token.address, walletAddress);
                    return {
                        ...token,
                        balance: balance ? balance.balance : '0',
                        decimals: balance ? balance.decimals : 18
                    };
                })
            );

            return {
                tokens: tokensWithBalances,
                message: tokensWithBalances.length > 0 
                    ? `Found ${tokensWithBalances.length} tokens`
                    : 'No tokens found'
            };
        } catch (error) {
            console.error('Error in getTokensAndTransfers:', error);
            throw error;
        }
    }
}

module.exports = TokenFetcher;
