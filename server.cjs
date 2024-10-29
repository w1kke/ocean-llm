require('dotenv').config();
const express = require('express');
const { ChatOpenAI } = require('@langchain/openai');
const { HumanMessage, SystemMessage } = require('@langchain/core/messages');
const { NftFactory, ConfigHelper, ProviderInstance, Aquarius, getHash } = require('@oceanprotocol/lib');
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



const nftAbi = [
    {
        "inputs": [
            { "internalType": "uint8", "name": "_metaDataState", "type": "uint8" },
            { "internalType": "string", "name": "_metaDataDecryptorUrl", "type": "string" },
            { "internalType": "string", "name": "_metaDataDecryptorAddress", "type": "string" },
            { "internalType": "bytes", "name": "flags", "type": "bytes" },
            { "internalType": "bytes", "name": "data", "type": "bytes" },
            { "internalType": "bytes32", "name": "_metaDataHash", "type": "bytes32" },
            {
                "internalType": "tuple[]",
                "name": "additionalParams",
                "type": "tuple[]",
                "components": [
                    { "internalType": "address", "name": "param1", "type": "address" },
                    { "internalType": "uint8", "name": "param2", "type": "uint8" },
                    { "internalType": "bytes32", "name": "param3", "type": "bytes32" },
                    { "internalType": "bytes32", "name": "param4", "type": "bytes32" }
                ]
            }
        ],
        "name": "setMetaData",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    }
];



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
            templateIndex: 1,
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
        const { nftAddress, metadata, chainId, publisherAddress } = req.body;

        if (!nftAddress || !metadata || !chainId || !publisherAddress) {
            throw new Error('Missing required parameters');
        }

        const oceanConfig = await initializeOcean();
        const did = calculateDID(nftAddress, chainId);

        console.log(did)

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
        if (!isAssetValid.valid) {
            throw new Error(`DDO Validation Failed: ${JSON.stringify(isAssetValid)}`);
        }

        // Encrypt the DDO using ProviderInstance
        const encryptedDDO = await ProviderInstance.encrypt(
            ddo,
            oceanConfig.chainId,
            oceanConfig.providerUri
        );


        const rawHash = getHash(JSON.stringify(ddo));
        const metadataHash = rawHash.startsWith('0x') ? rawHash : `0x${rawHash}`;

        console.log("Formatted Metadata Hash:", metadataHash); // For debugging

        // Continue with transaction setup
        const nftInterface = new ethers.utils.Interface(nftAbi);
        const txData = nftInterface.encodeFunctionData("setMetaData", [
            0,                                               // _metaDataState (uint8)
            "https://v4.provider.oceanprotocol.com",         // _metaDataDecryptorUrl (string)
            "0x123",                                         // _metaDataDecryptorAddress (address)
            '0x02',                                          // flags (bytes)
            encryptedDDO,                                    // data (bytes, encrypted DDO)
            metadataHash,                                    // _metaDataHash (bytes32)
            []                                               // additionalParams as empty array if not needed
        ]);



        // Construct the transaction object to return
        const transaction = {
            to: nftAddress,
            from: publisherAddress,
            data: txData,
            chainId: oceanConfig.chainId
        };

        res.json({
            success: true,
            transaction,   // Send back transaction for frontend signature
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
