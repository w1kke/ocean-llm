require('dotenv').config();
const express = require('express');
const { ChatOpenAI } = require('@langchain/openai');
const { HumanMessage, SystemMessage } = require('@langchain/core/messages');
const { NftFactory, ConfigHelper, ProviderInstance, Nft } = require('@oceanprotocol/lib');
const ethers = require('ethers');

const app = express();
const PORT = process.env.PORT || 3000;

const chat = new ChatOpenAI({
    openAIApiKey: process.env.OPENAI_API_KEY,
    temperature: 0.7
});

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

        const oceanConfig = await initializeOcean();
        const provider = new ethers.providers.JsonRpcProvider(oceanConfig.nodeUri);
        const factory = new NftFactory(oceanConfig.nftFactoryAddress, provider);

        const nftParams = {
            name: metadata.nftName,
            symbol: metadata.nftSymbol,
            templateIndex: 1,
            tokenURI: "",
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

        res.json({ success: true, txData, metadata });

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

        const ddo = {
            '@context': 'https://w3id.org/did/v1',
            id: `did:op:${nftAddress}`,
            version: '4.1.0',
            chainId: oceanConfig.chainId,
            nftAddress,
            metadata: {
                ...metadata,
                datatokenAddress: nftAddress,
            },
            services: [
                {
                    id: 'access',
                    type: 'access',
                    description: 'Download Service',
                    files: 'encryptedFiles',
                    datatokenAddress: nftAddress,
                    serviceEndpoint: oceanConfig.providerUri,
                    timeout: 0
                }
            ]
        };

        const encryptedDDO = await ProviderInstance.encrypt(
            ddo,
            oceanConfig.chainId,
            oceanConfig.providerUri
        );

        await nft.setMetadata(
            nftAddress,
            userAddress,
            1,
            oceanConfig.providerUri,
            '0x123',
            '0x02',
            encryptedDDO,
            ddo.id,
            []
        );

        res.json({ success: true, message: 'Metadata updated successfully', ddo });
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
