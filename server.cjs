require('dotenv').config();
const express = require('express');
const Web3 = require('web3');
const { ChatOpenAI } = require('@langchain/openai');
const { HumanMessage, SystemMessage } = require('@langchain/core/messages');
const { ConfigHelper, NftFactory } = require('@oceanprotocol/lib');
const { ethers } = require('ethers');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize ChatOpenAI
const chat = new ChatOpenAI({
    openAIApiKey: process.env.OPENAI_API_KEY,
    temperature: 0.7
});

// Set up middleware
app.use(express.static('public'));
app.use(express.json());
app.set('view engine', 'ejs');
app.set('views', './views');

// Debug setup
const DEBUG = true;
function debug(...args) {
    if (DEBUG) {
        console.log('[DEBUG]', ...args);
    }
}



async function initializeOcean() {
  debug('Starting Ocean Protocol initialization...');
  
  try {
      const provider = new ethers.providers.JsonRpcProvider(process.env.OCEAN_NETWORK_URL);
      debug('Provider created with URL:', process.env.OCEAN_NETWORK_URL);

      // Get network information
      const network = await provider.getNetwork();
      debug('Network information:', network);

      const configHelper = new ConfigHelper();
      const baseConfig = configHelper.getConfig('sepolia');
      debug('Base config retrieved');

      const oceanConfig = {
          ...baseConfig,
          provider,
          chainId: network.chainId,
          network: network.name,
          nodeUri: process.env.OCEAN_NETWORK_URL,
          providerUri: process.env.PROVIDER_URL,
          metadataCacheUri: process.env.AQUARIUS_URL
      };
      
      debug('Ocean config created');
      return oceanConfig;
  } catch (error) {
      debug('Error during initialization:', error);
      throw error;
  }
}
app.post('/api/create-and-publish-nft', async (req, res) => {
    try {
        const { prompt, userAddress } = req.body;
        if (!prompt || !userAddress) {
            throw new Error('Missing required parameters: prompt and userAddress');
        }

        debug('Received request to create NFT with prompt:', prompt);
        debug('User address:', userAddress);

        // Initialize Ocean
        const oceanConfig = await initializeOcean();
        debug('Ocean config initialized successfully');
        
        // Create Web3 provider
        const provider = new ethers.providers.JsonRpcProvider(process.env.OCEAN_NETWORK_URL);
        debug('Web3 provider created');

        // NFT Factory ABI - expanded for clarity
        const NFT_FACTORY_ABI = [{
            "inputs": [{
                "components": [{
                    "internalType": "string",
                    "name": "name",
                    "type": "string"
                }, {
                    "internalType": "string",
                    "name": "symbol",
                    "type": "string"
                }, {
                    "internalType": "uint256",
                    "name": "templateIndex",
                    "type": "uint256"
                }, {
                    "internalType": "string",
                    "name": "tokenURI",
                    "type": "string"
                }, {
                    "internalType": "bool",
                    "name": "transferable",
                    "type": "bool"
                }, {
                    "internalType": "address",
                    "name": "owner",
                    "type": "address"
                }],
                "name": "_NftCreateData",
                "type": "tuple"
            }, {
                "components": [{
                    "internalType": "uint256",
                    "name": "templateIndex",
                    "type": "uint256"
                }, {
                    "internalType": "string[]",
                    "name": "strings",
                    "type": "string[]"
                }, {
                    "internalType": "address[]",
                    "name": "addresses",
                    "type": "address[]"
                }, {
                    "internalType": "uint256[]",
                    "name": "uints",
                    "type": "uint256[]"
                }, {
                    "internalType": "bytes[]",
                    "name": "bytess",
                    "type": "bytes[]"
                }],
                "name": "_ErcCreateData",
                "type": "tuple"
            }, {
                "components": [{
                    "internalType": "address",
                    "name": "dispenserAddress",
                    "type": "address"
                }, {
                    "internalType": "uint256",
                    "name": "maxTokens",
                    "type": "uint256"
                }, {
                    "internalType": "uint256",
                    "name": "maxBalance",
                    "type": "uint256"
                }, {
                    "internalType": "bool",
                    "name": "withMint",
                    "type": "bool"
                }, {
                    "internalType": "address",
                    "name": "allowedSwapper",
                    "type": "address"
                }],
                "name": "_DispenserData",
                "type": "tuple"
            }],
            "name": "createNftWithErc20WithDispenser",
            "outputs": [{
                "internalType": "address",
                "name": "",
                "type": "address"
            }, {
                "internalType": "address",
                "name": "",
                "type": "address"
            }],
            "stateMutability": "nonpayable",
            "type": "function"
        }];

        const nftFactoryContract = new ethers.Contract(
            oceanConfig.nftFactoryAddress,
            NFT_FACTORY_ABI,
            provider
        );
        debug('NFT Factory contract instance created');

        // Generate AI content
        const messages = [
            new SystemMessage(`You are an AI that creates NFT metadata. 
                Please respond in JSON format with exactly these fields:
                {
                    "shortName": "a name under 10 characters",
                    "description": "detailed description"
                }`),
            new HumanMessage(`Create NFT metadata for: ${prompt}`)
        ];
        const aiResponse = await chat.invoke(messages);
        const aiData = JSON.parse(aiResponse.content);
        debug('AI response parsed:', aiData);

        // Prepare NFT parameters
        const nftCreateData = {
            name: `AI:${aiData.shortName}`,
            symbol: 'AINFT',
            templateIndex: 1,
            tokenURI: '',
            transferable: true,
            owner: ethers.utils.getAddress(userAddress)
        };
        
        // Prepare ERC20 parameters with exact values
        const ercCreateData = {
            templateIndex: 2,
            strings: [
                `AI:${aiData.shortName}`,  // Changed to match NFT name exactly
                'AITKN'
            ],
            addresses: [
                ethers.utils.getAddress(userAddress),
                ethers.utils.getAddress(userAddress),
                ethers.utils.getAddress(userAddress),
                '0x1B083D8584dd3e6Ff37d04a6e7e82b5F622f3985'
            ],
            uints: [
                '100000000000000000000000',
                '0'
            ],
            bytess: []
        };
        
        // Prepare dispenser parameters with fixed amounts
        const dispenserData = {
            dispenserAddress: '0x2720d405ef7cDC8a2E2e5AeBC8883C99611d893C',
            maxTokens: '1000000000000000000',
            maxBalance: '10000000000000000000',
            withMint: true,
            allowedSwapper: ethers.utils.getAddress(userAddress)
        };

        debug('Contract addresses:', {
            nftFactory: oceanConfig.nftFactoryAddress,
            dispenser: oceanConfig.dispenserAddress,
            oceanToken: oceanConfig.oceanTokenAddress
        });
        
        // Get the unsigned transaction data
        const unsignedTx = await nftFactoryContract.populateTransaction.createNftWithErc20WithDispenser(
            [
                nftCreateData.name,
                nftCreateData.symbol,
                nftCreateData.templateIndex,
                nftCreateData.tokenURI,
                nftCreateData.transferable,
                nftCreateData.owner
            ],
            [
                ercCreateData.templateIndex,
                ercCreateData.strings,
                ercCreateData.addresses,
                ercCreateData.uints,
                ercCreateData.bytess
            ],
            [
                dispenserData.dispenserAddress,
                dispenserData.maxTokens,
                dispenserData.maxBalance,
                dispenserData.withMint,
                dispenserData.allowedSwapper
            ]
        );

        // Estimate gas
        const gasEstimate = await provider.estimateGas({
            from: userAddress,
            to: oceanConfig.nftFactoryAddress,
            data: unsignedTx.data
        });

        // Format the transaction
        const formattedTx = {
            from: userAddress,
            to: oceanConfig.nftFactoryAddress,
            data: unsignedTx.data,
            value: '0x0',
            gasLimit: ethers.utils.hexlify(gasEstimate.mul(120).div(100)), // Add 20% buffer
            chainId: oceanConfig.chainId,
            nonce: await provider.getTransactionCount(userAddress)
        };

        debug('Transaction parameters:', {
            nftCreateData: [
                nftCreateData.name,
                nftCreateData.symbol,
                nftCreateData.templateIndex,
                nftCreateData.tokenURI,
                nftCreateData.transferable,
                nftCreateData.owner
            ],
            ercCreateData: [
                ercCreateData.templateIndex,
                ercCreateData.strings,
                ercCreateData.addresses,
                ercCreateData.uints,
                ercCreateData.bytess
            ],
            dispenserData: [
                dispenserData.dispenserAddress,
                dispenserData.maxTokens,
                dispenserData.maxBalance,
                dispenserData.withMint,
                dispenserData.allowedSwapper
            ]
        });

        // Create metadata for frontend reference
        const metadata = {
            type: 'dataset',
            name: `AI:${aiData.shortName}`,
            description: aiData.description,
            author: userAddress.toLowerCase(),
            license: 'CC0',
            links: [],
            tags: ['AI', 'Generated', 'NFT'],
            additionalInformation: {
                generatedFrom: prompt
            }
        };

        res.json({
            success: true,
            metadata,
            unsignedTx: formattedTx,
            createData: {
                nftCreateData,
                ercCreateData,
                dispenserData
            }
        });

    } catch (error) {
        console.error('NFT creation error:', error);
        debug('Error details:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Main route
app.get('/', (req, res) => {
    res.render('index');
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    debug('Server started, environment variables loaded:',
        {
            OCEAN_NETWORK_URL: process.env.OCEAN_NETWORK_URL ? 'Set' : 'Not set',
            PROVIDER_URL: process.env.PROVIDER_URL ? 'Set' : 'Not set',
            AQUARIUS_URL: process.env.AQUARIUS_URL ? 'Set' : 'Not set',
            OPENAI_API_KEY: process.env.OPENAI_API_KEY ? 'Set' : 'Not set'
        }
    );
});