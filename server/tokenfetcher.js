const { ethers } = require('ethers');

// Combine all ABIs into one interface to reduce contract instantiations
const COMBINED_ABI = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function getERC721Address() view returns (address)",
    "function getTokensList() view returns (address[])",
    "function getDispensers() view returns (address[])"
];

class TokenFetcher {
    constructor(provider, dispenserAddress) {
        this.provider = provider;
        this.dispenserAddress = dispenserAddress;
        this.cache = new Map(); // Add caching
    }

    async findNFTForToken(tokenAddress) {
        // Check cache first
        const cacheKey = `nft_${tokenAddress.toLowerCase()}`;
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        try {
            // Get contract code and check if it's a contract in one batch
            const [code, contract] = await Promise.all([
                this.provider.getCode(tokenAddress),
                new ethers.Contract(tokenAddress, COMBINED_ABI, this.provider)
            ]);

            if (code === '0x') return null;

            // Try direct token info first
            try {
                const [name, symbol, erc721Address] = await Promise.all([
                    contract.name(),
                    contract.symbol(),
                    contract.getERC721Address()
                ]);

                if (erc721Address && erc721Address !== ethers.constants.AddressZero) {
                    const result = {
                        address: tokenAddress,
                        name,
                        symbol,
                        erc721Address
                    };
                    this.cache.set(cacheKey, result);
                    return result;
                }
            } catch {
                // Continue to tokens list check if direct check fails
            }

            // Check tokens list
            try {
                const tokensList = await contract.getTokensList();
                
                // Process tokens in parallel instead of sequentially
                const tokensPromises = tokensList.map(async (nftAddress) => {
                    try {
                        const nftContract = new ethers.Contract(nftAddress, COMBINED_ABI, this.provider);
                        const [name, symbol, erc721Address] = await Promise.all([
                            nftContract.name(),
                            nftContract.symbol(),
                            nftContract.getERC721Address()
                        ]);

                        if (erc721Address && erc721Address !== ethers.constants.AddressZero) {
                            return {
                                address: nftAddress,
                                name,
                                symbol,
                                initialTokenAddress: tokenAddress,
                                erc721Address
                            };
                        }
                    } catch {
                        return null;
                    }
                });

                const results = await Promise.all(tokensPromises);
                const validToken = results.find(r => r !== null);
                
                if (validToken) {
                    this.cache.set(cacheKey, validToken);
                    return validToken;
                }
            } catch {
                // Return null if tokens list check fails
            }

            return null;
        } catch (error) {
            console.error(`Error analyzing token ${tokenAddress}:`, error);
            return null;
        }
    }

    async getTokensAndTransfers(walletAddress) {
        try {
            const currentBlock = await this.provider.getBlockNumber();
            const fromBlock = Math.max(0, currentBlock - 10000);
    
            // Get both incoming and outgoing transfers
            const [incomingEvents, outgoingEvents] = await Promise.all([
                this.provider.getLogs({
                    topics: [
                        ethers.utils.id("Transfer(address,address,uint256)"),
                        null,  // from address (any)
                        ethers.utils.hexZeroPad(walletAddress, 32)  // to address (our wallet)
                    ],
                    fromBlock: '0x' + fromBlock.toString(16)
                }),
                this.provider.getLogs({
                    topics: [
                        ethers.utils.id("Transfer(address,address,uint256)"),
                        ethers.utils.hexZeroPad(walletAddress, 32),  // from address (our wallet)
                        null  // to address (any)
                    ],
                    fromBlock: '0x' + fromBlock.toString(16)
                })
            ]);
    
            // Combine events and deduplicate token addresses
            const allEvents = [...incomingEvents, ...outgoingEvents];
            const tokenAddresses = [...new Set(allEvents.map(event => 
                event.address.toLowerCase()
            ))];
    
            console.log(`Found ${tokenAddresses.length} unique token addresses`);
    
            // Process tokens in parallel with batched promises
            const BATCH_SIZE = 5;
            const tokens = [];
            
            for (let i = 0; i < tokenAddresses.length; i += BATCH_SIZE) {
                const batch = tokenAddresses.slice(i, i + BATCH_SIZE);
                const batchResults = await Promise.all(
                    batch.map(address => this.findNFTForToken(address))
                );
                tokens.push(...batchResults.filter(t => t !== null));
            }
    
            // Deduplicate tokens by address
            const uniqueTokens = Array.from(new Map(
                tokens.map(token => [token.address.toLowerCase(), token])
            ).values());
    
            console.log(`Found ${uniqueTokens.length} unique tokens after NFT check`);
    
            // Get balances in parallel
            const tokensWithBalances = await Promise.all(
                uniqueTokens.map(async (token) => {
                    const contract = new ethers.Contract(token.address, COMBINED_ABI, this.provider);
                    try {
                        const [balance, decimals] = await Promise.all([
                            contract.balanceOf(walletAddress),
                            contract.decimals()
                        ]);
    
                        return {
                            ...token,
                            balance: balance.toString(),
                            decimals,
                            transfers: allEvents.filter(event => 
                                event.address.toLowerCase() === token.address.toLowerCase()
                            )
                        };
                    } catch (error) {
                        return null;
                    }
                })
            );
    
            const finalTokens = tokensWithBalances.filter(t => t !== null);
            console.log(`Final token count: ${finalTokens.length}`);
    
            return {
                tokens: finalTokens,
                message: finalTokens.length > 0 
                    ? `Found ${finalTokens.length} tokens`
                    : 'No tokens found'
            };
        } catch (error) {
            console.error('Error in getTokensAndTransfers:', error);
            throw error;
        }
    }
}

module.exports = TokenFetcher;