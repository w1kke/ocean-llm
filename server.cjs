require('dotenv').config();
const express = require('express');
const { ChatOpenAI } = require('@langchain/openai');
const { HumanMessage, SystemMessage } = require('@langchain/core/messages');
const { NftFactory, ConfigHelper, ProviderInstance, Aquarius, Nft } = require('@oceanprotocol/lib');
const CryptoJS = require('crypto-js');
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

function calculateDID(nftAddress, chainId) {
    const checksum = CryptoJS.SHA256(nftAddress + chainId.toString(10)).toString(CryptoJS.enc.Hex);
    return `did:op:${checksum}`;
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

app.post('/api/encrypt-metadata', async (req, res) => {
    try {
        const { nftAddress, metadata, chainId } = req.body;

        if (!nftAddress || !metadata || !chainId) throw new Error('Missing required parameters');

        const oceanConfig = await initializeOcean();
        const did = calculateDID(nftAddress, chainId);

        const ddo = {
            '@context': ['https://w3id.org/did/v1', 'https://w3id.org/ocean/metadata'],
            id: did,
            version: '4.1.0',
            chainId: oceanConfig.chainId,
            nftAddress,
            metadata: {
                ...metadata,
                type: 'dataset',
                name: metadata.nftName || "Default NFT Name",
                description: metadata.description || "No description provided",
                author: metadata.author || "Unknown Author",
                license: metadata.license || "No license",
                created: metadata.created || new Date().toISOString(),
                updated: new Date().toISOString(),
                datatokenAddress: nftAddress
            },
            services: [
                {
                    id: 'access',
                    type: 'access',
                    description: 'Download Service',
                    files: '',
                    datatokenAddress: nftAddress,
                    serviceEndpoint: oceanConfig.providerUri,
                    timeout: 0
                }
            ]
        };

        // Validate the DDO with Aquarius
        const aquarius = new Aquarius(oceanConfig.metadataCacheUri);
        const isAssetValid = await aquarius.validate(ddo);
        if (!isAssetValid.valid) throw new Error(`DDO Validation Failed: ${JSON.stringify(isAssetValid)}`);

        const encryptedDDO = await ProviderInstance.encrypt(
            ddo,
            oceanConfig.chainId,
            oceanConfig.providerUri
        );

        // Populate `setMetadata` transaction using the Nft instance
        const nftContract = new Nft(oceanConfig.nodeUri);
        const populatedTransaction = await nftContract.populateTransaction.setMetadata(
            nftAddress,
            publisherAddress,         
            0,                        
            oceanConfig.providerUri,  
            '0x123',                  
            '0x02',                   
            encryptedDDO,             
            validationHash,           
            []                        
        );
        
        res.json({
            success: true,
            populatedTransaction,
            encryptedDDO,
            validationHash: isAssetValid.hash
        });
    } catch (error) {
        console.error('Error encrypting metadata:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});



app.get('/', (req, res) => {
    res.render('index');
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
