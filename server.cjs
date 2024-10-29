require('dotenv').config();
const express = require('express');
const { ChatOpenAI } = require('@langchain/openai');
const { HumanMessage, SystemMessage } = require('@langchain/core/messages');
const { NftFactory, ConfigHelper, ProviderInstance, Nft } = require('@oceanprotocol/lib');
const ethers = require('ethers');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize chat based on available API keys
function initializeChat() {
    const config = {
        temperature: 0.7
    };

    if (process.env.OPENAI_API_KEY) {
        return new ChatOpenAI({
            openAIApiKey: process.env.OPENAI_API_KEY,
            ...config
        });
    } else if (process.env.OPENROUTER_API_KEY) {
        return new ChatOpenAI({
            openAIApiKey: process.env.OPENROUTER_API_KEY,
            configuration: {
                baseURL: "https://openrouter.ai/api/v1",
                defaultHeaders: {
                    "HTTP-Referer": process.env.OPENROUTER_REFERER || "http://localhost:3000",
                    "X-Title": process.env.OPENROUTER_TITLE || "Ocean LLM App"
                }
            },
            ...config
        });
    } else {
        throw new Error('No API key found. Please provide either OPENAI_API_KEY or OPENROUTER_API_KEY in your environment variables.');
    }
}

const chat = initializeChat();

app.use(express.static('public'));
app.use(express.json());
app.set('view engine', 'ejs');
app.set('views', './views');

const DEBUG = true;
function debug(...args) {
    if (DEBUG) console.log('[DEBUG]', ...args);
}

async function initializeOcean() {
    debug('Starting Ocean Protocol initialization...');
    const configHelper = new ConfigHelper();
    const baseConfig = configHelper.getConfig('sepolia');

    return {
        ...baseConfig,
        nodeUri: process.env.OCEAN_NETWORK_URL,
        providerUri: process.env.PROVIDER_URL,
        metadataCacheUri: process.env.AQUARIUS_URL,
        nftFactoryAddress: baseConfig.nftFactoryAddress,
        chainId: baseConfig.chainId
    };
}

async function createDDO(nftAddress, metadata, oceanConfig) {
    const currentTime = new Date().toISOString();
    
    return {
        '@context': ['https://w3id.org/did/v1'],
        id: `did:op:${nftAddress}`,
        version: '4.1.0',
        chainId: oceanConfig.chainId,
        nftAddress: nftAddress,
        metadata: {
            created: currentTime,
            updated: currentTime,
            type: 'dataset',
            name: metadata.nftName,
            description: metadata.description,
            author: metadata.author,
            license: "https://market.oceanprotocol.com/terms",
            links: ["https://oceanprotocol.com"],
            additionalInformation: {
                symbol: metadata.nftSymbol,
                datatokenSymbol: metadata.datatokenSymbol,
                datatokenName: metadata.datatokenName
            }
        },
        services: [
            {
                id: 'marketplace',
                type: 'metadata',
                files: {
                    contentType: 'application/json',
                    structured: true
                },
                datatokenAddress: nftAddress,
                serviceEndpoint: oceanConfig.providerUri,
                timeout: 0
            }
        ],
        nft: {
            name: metadata.nftName,
            symbol: metadata.nftSymbol,
            owner: metadata.owner,
            created: currentTime
        }
    };
}

app.post('/api/create-and-publish-nft', async (req, res) => {
    try {
        const { prompt, userAddress } = req.body;
        if (!prompt || !userAddress) throw new Error('Missing required parameters: prompt and userAddress');

        const messages = [
            new SystemMessage(`You are an AI that creates NFT metadata. Respond in JSON format with nftName, nftSymbol, datatokenName, datatokenSymbol, description, author.`),
            new HumanMessage(`Create NFT metadata for: ${prompt}`)
        ];
        const aiResponse = await chat.invoke(messages);
        const metadata = JSON.parse(aiResponse.content.replace(/`/g, '').trim());
        metadata.owner = userAddress;

        const oceanConfig = await initializeOcean();
        const provider = new ethers.providers.JsonRpcProvider(oceanConfig.nodeUri);
        const factory = new NftFactory(oceanConfig.nftFactoryAddress, provider);

        // Create initial DDO for tokenURI
        const initialDDO = await createDDO('0x0000000000000000000000000000000000000000', metadata, oceanConfig);
        const encryptedDDO = await ProviderInstance.encrypt(
            initialDDO,
            oceanConfig.chainId,
            oceanConfig.providerUri
        );

        const nftParams = {
            name: metadata.nftName,
            symbol: metadata.nftSymbol,
            templateIndex: 1,
            tokenURI: encryptedDDO,
            transferable: true,
            owner: userAddress
        };
        
        const datatokenParams = {
            templateIndex: 2,
            strings: [metadata.datatokenName, metadata.datatokenSymbol],
            addresses: [userAddress, userAddress, userAddress, oceanConfig.oceanTokenAddress],
            uints: [ethers.utils.parseUnits('100000', 18).toString(), '0'],
            bytess: []
        };

        const dispenserParams = {
            dispenserAddress: oceanConfig.dispenserAddress,
            maxTokens: ethers.utils.parseUnits('1000', 18).toString(),
            maxBalance: ethers.utils.parseUnits('100', 18).toString(),
            withMint: true,
            allowedSwapper: userAddress
        };

        // Create NFT with encrypted DDO as tokenURI
        const txData = await factory.contract.populateTransaction.createNftWithErc20WithDispenser(
            [
                nftParams.name, nftParams.symbol, nftParams.templateIndex,
                nftParams.tokenURI, nftParams.transferable, nftParams.owner
            ],
            [
                datatokenParams.templateIndex, datatokenParams.strings,
                datatokenParams.addresses, datatokenParams.uints,
                datatokenParams.bytess
            ],
            [
                dispenserParams.dispenserAddress, dispenserParams.maxTokens,
                dispenserParams.maxBalance, dispenserParams.withMint,
                dispenserParams.allowedSwapper
            ]
        );

        res.json({ 
            success: true, 
            txData, 
            metadata,
            ddo: initialDDO
        });

    } catch (error) {
        console.error('Error during NFT creation:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/update-nft-metadata', async (req, res) => {
    try {
        const { nftAddress, metadata, userAddress } = req.body;
        if (!nftAddress || !metadata || !userAddress) throw new Error('Missing required parameters');

        const oceanConfig = await initializeOcean();
        const provider = new ethers.providers.JsonRpcProvider(oceanConfig.nodeUri);
        const nft = new Nft(nftAddress, provider);

        const ddo = await createDDO(nftAddress, metadata, oceanConfig);
        const encryptedDDO = await ProviderInstance.encrypt(
            ddo,
            oceanConfig.chainId,
            oceanConfig.providerUri
        );

        // Update metadata on-chain
        const metadataTx = await nft.setMetadata(
            oceanConfig.providerUri,
            encryptedDDO,
            userAddress
        );
        await metadataTx.wait();

        res.json({ 
            success: true, 
            message: 'Metadata updated successfully', 
            ddo,
            transactionHash: metadataTx.hash 
        });
    } catch (error) {
        console.error('Error updating metadata:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/', (req, res) => {
    res.render('index');
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
