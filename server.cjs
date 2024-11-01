require('dotenv').config();
require('blob-polyfill');
const express = require('express');
const { ChatOpenAI } = require('@langchain/openai');
const { HumanMessage, SystemMessage } = require('@langchain/core/messages');
const { NftFactory, ConfigHelper, ProviderInstance, Aquarius, getHash, ZERO_ADDRESS } = require('@oceanprotocol/lib');
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
        chainId: baseConfig.chainId,
        OPFCommunityFeeCollector: baseConfig.OPFCommunityFeeCollector,
        FixedPrice: baseConfig.FixedPrice
    };
}




function calculateDID(nftAddress, chainId) {
    const checksum = CryptoJS.SHA256(nftAddress + chainId.toString(10)).toString(CryptoJS.enc.Hex);
    return `did:op:${checksum}`;
}

async function generateMetadata(prompt, userPrice = null) {
    const messages = [
        new SystemMessage(`You are an AI that creates detailed NFT metadata with an estimated price. Provide engaging metadata that captures the essence of the concept.
        Respond in JSON format with:
        {
            "nftName": "Creative and catchy name",
            "nftSymbol": "3-5 letter symbol",
            "datatokenName": "Descriptive datatoken name",
            "datatokenSymbol": "3-5 letter symbol",
            "description": "Detailed, engaging description that captures the NFT's essence",
            "author": "Generated author name",
            "tags": ["array", "of", "relevant", "descriptive", "tags"],
            "category": "Primary category of the NFT",
            "suggestedPrice": "Suggested price for datatoken in Ocean tokens number only",
            "imagePrompt": "Detailed prompt for DALL-E to generate a preview image"
        }`),
        new HumanMessage(`Create detailed NFT metadata for this concept: ${prompt}`)
    ];

    const aiResponse = await chat.invoke(messages);
    const metadata = JSON.parse(aiResponse.content.replace(/`/g, '').trim());

    // Use user-provided price if specified, otherwise use the AI-suggested price
    metadata.price = userPrice ? ethers.utils.parseUnits(userPrice, 18).toString() : ethers.utils.parseUnits(metadata.suggestedPrice || '1', 18).toString();

    return metadata;
}


async function generateAndUploadPreviewImage(imagePrompt) {
    // Generate preview image using DALL-E
    const imageResponse = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
            prompt: imagePrompt,
            n: 1,
            size: "1024x1024",
            response_format: "b64_json"
        })
    });

    const imageData = await imageResponse.json();
    const imageBuffer = Buffer.from(imageData.data[0].b64_json, 'base64');
    return await uploadToIPFS(imageBuffer, 'preview.png');
}


async function uploadToIPFS(fileData, fileName) {
    const formData = new FormData();
    formData.append('file', fileData, fileName);

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
        throw new Error(`IPFS upload failed with status: ${response.status}`);
    }

    const data = await response.json();
    return `https://ipfs.io/ipfs/${data.Hash}`;
}



app.get('/api/user-assets/:address/:chainId', async (req, res) => {
    try {
        const { address, chainId } = req.params;

        const response = await fetch('https://v4.aquarius.oceanprotocol.com/api/aquarius/assets/query', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                query: {
                    bool: {
                        must: [
                            { match: { "nft.owner": address } },
                            { match: { "chainId": parseInt(chainId) } }
                        ]
                    }
                },
                sort: [
                    { "metadata.created": { "order": "desc" } }
                ],
                size: 100
            })
        });

        const data = await response.json();
        res.json({ success: true, assets: data.hits.hits });
    } catch (error) {
        console.error('Error fetching user assets:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

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



app.post('/api/create-and-publish-nft', async (req, res) => {
    const { prompt, userAddress, ipfsUrl } = req.body;

    try {
        const metadata = await generateMetadata(prompt);

        const previewImageUrl = await generateAndUploadPreviewImage(metadata.imagePrompt);

        metadata.previewImageUrl = previewImageUrl;
        if (ipfsUrl) {
            metadata.assetUrl = ipfsUrl;
        }

        // Ocean Protocol NFT creation setup
        const oceanConfig = await initializeOcean();
        console.log("Ocean Config:", oceanConfig);
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
            addresses: [
                checksummedUserAddress,          // Minter
                ZERO_ADDRESS,          // Payment collector
                ZERO_ADDRESS,          // Fee address (could vary if there's a separate fee collector)
                oceanConfig.oceanTokenAddress    // Base token (usually the address for Ocean token)
            ],
            uints: [
                ethers.utils.parseUnits('100000', 18).toString(), // Cap
                '0'                                               // Fee amount (assuming no fee)
            ],
            bytess: []
        };

        const dispenserParams = {
            dispenserAddress: oceanConfig.dispenserAddress,
            maxTokens: ethers.utils.parseUnits('1000', 18).toString(),
            maxBalance: ethers.utils.parseUnits('100', 18).toString(),
            withMint: true,
            allowedSwapper: ZERO_ADDRESS
        };

        /*
        const freParams = {
            fixedPriceAddress: oceanConfig.fixedRateExchangeAddress, // Correct reference for fixed rate address
            addresses: [
                oceanConfig.oceanTokenAddress,         // Base token address (usually Ocean token)
                checksummedUserAddress,                // Owner address
                oceanConfig.opfCommunityFeeCollector,  // Market fee collector address
                ZERO_ADDRESS                           // Allowed consumer (zero for no restrictions)
            ],
            uints: [
                18, // Base token decimals (Ocean token standard)
                18, // Datatoken decimals
                ethers.utils.parseUnits(metadata.suggestedPrice || '1', 18).toString(), // Fixed price (suggested or default 1 Ocean)
                ethers.utils.parseUnits('0.001', 18).toString(), // Market fee (default 0.001 Ocean)
                1 // withMint flag (1 for true)
            ]
        };
        */

        console.log("NFT Params:", nftParams);
        console.log("Datatoken Params:", datatokenParams);
        //console.log("Fixed Rate Params:", freParams);

        const txData = await factory.contract.populateTransaction.createNftWithErc20WithDispenser(
            [
                nftParams.name, nftParams.symbol, nftParams.templateIndex,
                nftParams.tokenURI, nftParams.transferable, nftParams.owner,
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
        const { nftAddress, datatokenAddress, dispenserAddress, metadata, chainId, publisherAddress } = req.body;

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
                datatokenAddress: datatokenAddress,
                links: metadata.previewImageUrl ? [metadata.previewImageUrl] : [],
                tags: metadata.tags || [],
                additionalInformation: metadata.additionalInformation || {}
            },
            services: [
                {
                    id: 'downloadService',
                    type: 'access',
                    description: 'Download Service',
                    files: '',
                    datatokenAddress: datatokenAddress,
                    serviceEndpoint: oceanConfig.providerUri,
                    timeout: 0
                }
            ]
        };

        // Prepare `Files` object with updated `datatokenAddress` and `nftAddress`
        const Files = {
            datatokenAddress: datatokenAddress,
            nftAddress: checksummedNftAddress,
            files: [
                {
                    type: 'url',
                    url: metadata.assetUrl,
                    method: 'GET'
                }
            ]
        };

        const fixedDDO = { ...ddo };

        // Encrypt the files and set them in `fixedDDO.services[0].files`
        fixedDDO.services[0].files = await ProviderInstance.encrypt(
            Files,
            oceanConfig.chainId,
            oceanConfig.providerUri
        );
        fixedDDO.services[0].datatokenAddress = datatokenAddress;

        console.log('NFT Address:', checksummedNftAddress);
        console.log('Datatoken Address:', datatokenAddress);

        // Encrypt the full DDO
        const encryptedDDO = await ProviderInstance.encrypt(
            fixedDDO,
            oceanConfig.chainId,
            oceanConfig.providerUri
        );


        // Validate the DDO with Aquarius
        const aquarius = new Aquarius(oceanConfig.metadataCacheUri);
        const isAssetValid = await aquarius.validate(fixedDDO);
        if (!isAssetValid.valid) {
            throw new Error(`DDO Validation Failed: ${JSON.stringify(isAssetValid)}`);
        }

        const rawHash = getHash(JSON.stringify(ddo));
        const metadataHash = rawHash.startsWith('0x') ? rawHash : `0x${rawHash}`;

        // Set up transaction for setMetaData
        const nftInterface = new ethers.utils.Interface(nftAbi);
        const txData = nftInterface.encodeFunctionData("setMetaData", [
            0,                                               // _metaDataState (uint8)
            oceanConfig.providerUri,                         // _metaDataDecryptorUrl (string)
            '0x123',                     // _metaDataDecryptorAddress (string)
            '0x02',                                          // flags (bytes)
            encryptedDDO,                                    // data (bytes, encrypted DDO)
            metadataHash,                                    // _metaDataHash (bytes32)
            []                                               // additionalParams as empty array if not needed
        ]);

        // Estimate gas for the transaction
        const gasEstimate = await provider.estimateGas({
            to: checksummedNftAddress,
            data: txData,
            from: checksummedPublisherAddress
        });

        // Convert gas limit to hex
        const gasLimitHex = '0x' + gasEstimate.mul(12).div(10).toHexString().slice(2);

        // Construct transaction
        const transaction = {
            to: checksummedNftAddress,
            data: txData,
            gasLimit: gasLimitHex
        };

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