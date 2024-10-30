require('dotenv').config();
require('blob-polyfill');
const express = require('express');
const { ChatOpenAI } = require('@langchain/openai');
const { HumanMessage, SystemMessage } = require('@langchain/core/messages');
const { NftFactory, ConfigHelper, ProviderInstance, Aquarius, getHash } = require('@oceanprotocol/lib');
const CryptoJS = require('crypto-js');
const ethers = require('ethers');
const fileUpload = require('express-fileupload');
const { Buffer } = require('buffer');
const fetch = require('node-fetch');
const FormData = require('form-data');

const app = express();
const PORT = process.env.PORT || 3000;

const chat = new ChatOpenAI({
    openAIApiKey: process.env.OPENAI_API_KEY,
    temperature: 0.7
});

app.use(express.static('public'));
app.use(express.json());
app.use(fileUpload({
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max file size
}));
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

// File upload endpoint
app.post('/api/upload', async (req, res) => {
    try {
        if (!req.files || !req.files.file) {
            return res.status(400).json({ success: false, error: 'No file uploaded' });
        }

        const file = req.files.file;
        const formData = new FormData();
        formData.append('file', file.data, file.name);

        const projectId = process.env.INFURA_PROJECT_ID;
        const projectSecret = process.env.INFURA_PROJECT_SECRET;
        const auth = 'Basic ' + Buffer.from(projectId + ':' + projectSecret).toString('base64');

        const response = await fetch('https://ipfs.infura.io:5001/api/v0/add', {
            method: 'POST',
            headers: {
                'Authorization': auth
            },
            body: formData
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        const ipfsUrl = `https://ipfs.io/ipfs/${data.Hash}`;

        res.json({
            success: true,
            cid: data.Hash,
            ipfsUrl
        });
    } catch (error) {
        console.error('Error uploading to IPFS:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

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
        const { prompt, userAddress, ipfsUrl } = req.body;
        if (!prompt || !userAddress) throw new Error('Missing required parameters: prompt and userAddress');

        const messages = [
            new SystemMessage(`You are an AI that creates NFT metadata. Respond in JSON format with nftName, nftSymbol, datatokenName, datatokenSymbol, description, author.`),
            new HumanMessage(`Create NFT metadata for: ${prompt}`)
        ];
        const aiResponse = await chat.invoke(messages);
        const metadata = JSON.parse(aiResponse.content.replace(/`/g, '').trim());

        if (ipfsUrl) {
            metadata.assetUrl = ipfsUrl;
        }

        const oceanConfig = await initializeOcean();
        const provider = new ethers.providers.JsonRpcProvider(oceanConfig.nodeUri);
        const factory = new NftFactory(oceanConfig.nftFactoryAddress, provider);

        const checksummedUserAddress = ethers.utils.getAddress(userAddress);

        const nftParams = {
            name: metadata.nftName,
            symbol: metadata.nftSymbol,
            templateIndex: 1,
            tokenURI: "",
            transferable: true,
            owner: checksummedUserAddress
        };

        const datatokenParams = {
            templateIndex: 1,
            strings: [metadata.datatokenName, metadata.datatokenSymbol],
            addresses: [checksummedUserAddress, checksummedUserAddress, checksummedUserAddress, oceanConfig.oceanTokenAddress],
            uints: [ethers.utils.parseUnits('100000', 18).toString(), '0'],
            bytess: []
        };

        const dispenserParams = {
            dispenserAddress: oceanConfig.dispenserAddress,
            maxTokens: ethers.utils.parseUnits('1000', 18).toString(),
            maxBalance: ethers.utils.parseUnits('100', 18).toString(),
            withMint: true,
            allowedSwapper: checksummedUserAddress
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

        // Estimate gas for the first transaction
        const gasEstimate = await provider.estimateGas({
            to: oceanConfig.nftFactoryAddress,
            data: txData.data,
            from: checksummedUserAddress
        });

        // Convert the gasLimit to hex
        const gasLimitHex = '0x' + gasEstimate.mul(12).div(10).toHexString().slice(2);

        const formattedTxData = {
            to: oceanConfig.nftFactoryAddress,
            data: txData.data,
            gasLimit: gasLimitHex
        };

        debug('Formatted transaction data:', formattedTxData);

        res.json({ success: true, txData: formattedTxData, metadata });

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

        const checksummedNftAddress = ethers.utils.getAddress(nftAddress);
        const checksummedPublisherAddress = ethers.utils.getAddress(publisherAddress);

        const oceanConfig = await initializeOcean();
        const provider = new ethers.providers.JsonRpcProvider(oceanConfig.nodeUri);
        const did = calculateDID(checksummedNftAddress, chainId);

        const ddo = {
            '@context': ['https://w3id.org/did/v1', 'https://w3id.org/ocean/metadata'],
            id: did,
            version: '4.1.0',
            chainId: oceanConfig.chainId,
            nftAddress: checksummedNftAddress,
            metadata: {
                ...metadata,
                type: 'dataset',
                name: metadata.nftName || "Default NFT Name",
                description: metadata.description || "No description provided",
                author: metadata.author || "Unknown Author",
                license: metadata.license || "No license",
                created: metadata.created || new Date().toISOString(),
                updated: new Date().toISOString(),
                datatokenAddress: checksummedNftAddress,
                links: metadata.assetUrl ? [metadata.assetUrl] : []
            },
            services: [
                {
                    id: 'access',
                    type: 'access',
                    description: 'Download Service',
                    files: '',
                    datatokenAddress: checksummedNftAddress,
                    serviceEndpoint: oceanConfig.providerUri,
                    timeout: 0
                }
            ]
        };

        const aquarius = new Aquarius(oceanConfig.metadataCacheUri);
        const isAssetValid = await aquarius.validate(ddo);
        if (!isAssetValid.valid) {
            throw new Error(`DDO Validation Failed: ${JSON.stringify(isAssetValid)}`);
        }

        const encryptedDDO = await ProviderInstance.encrypt(
            ddo,
            oceanConfig.chainId,
            oceanConfig.providerUri
        );

        const rawHash = getHash(JSON.stringify(ddo));
        const metadataHash = rawHash.startsWith('0x') ? rawHash : `0x${rawHash}`;

        // Continue with transaction setup
        const nftInterface = new ethers.utils.Interface(nftAbi);
        const txData = nftInterface.encodeFunctionData("setMetaData", [
            0,                                               // _metaDataState (uint8)
            oceanConfig.providerUri,                         // _metaDataDecryptorUrl (string)
            checksummedPublisherAddress,                     // _metaDataDecryptorAddress (string)
            '0x02',                                          // flags (bytes)
            encryptedDDO,                                    // data (bytes, encrypted DDO)
            metadataHash,                                    // _metaDataHash (bytes32)
            []                                               // additionalParams as empty array if not needed
        ]);

        // Estimate gas for the second transaction
        const gasEstimate = await provider.estimateGas({
            to: checksummedNftAddress,
            data: txData,
            from: checksummedPublisherAddress
        });

        // Convert the gasLimit to hex
        const gasLimitHex = '0x' + gasEstimate.mul(12).div(10).toHexString().slice(2);

        // Construct the transaction object to return
        const transaction = {
            to: checksummedNftAddress,
            data: txData,
            gasLimit: gasLimitHex
        };

        debug('Formatted metadata transaction:', transaction);

        res.json({
            success: true,
            transaction,
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
