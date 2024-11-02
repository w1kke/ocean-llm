const express = require('express');
const router = express.Router();
const { handleFileUpload } = require('../ipfs');
const { generateMetadata, generateAndUploadPreviewImage, fetchUserAssets } = require('../metadata');
const { nftAbi, initializeOcean, calculateDID, ZERO_ADDRESS, NftFactory, ProviderInstance, Aquarius, getHash, ethers } = require('../ocean');
const { debug } = require('../config');



// File upload endpoint
router.post('/upload', handleFileUpload);

// User assets endpoint
router.get('/user-assets/:address/:chainId', async (req, res) => {
    try {
        const { address, chainId } = req.params;
        const result = await fetchUserAssets(address, chainId);
        res.json(result);
    } catch (error) {
        console.error('Error fetching user assets:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// NFT creation endpoint
router.post('/create-and-publish-nft', async (req, res) => {
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
                checksummedUserAddress,          // Minter - only the creator can mint tokens
                ZERO_ADDRESS,          // Payment collector
                ZERO_ADDRESS,          // Fee address
                oceanConfig.oceanTokenAddress    // Base token
            ],
            uints: [
                ethers.utils.parseUnits('100000', 18).toString(), // Cap
                '0'                                               // Fee amount
            ],
            bytess: []
        };

        const dispenserParams = {
            dispenserAddress: oceanConfig.dispenserAddress,
            maxTokens: ethers.utils.parseUnits('1000', 18).toString(),
            maxBalance: ethers.utils.parseUnits('100', 18).toString(),
            withMint: false,  // Disable public minting through dispenser
            allowedSwapper: checksummedUserAddress  // Only creator can use dispenser
        };

        console.log("NFT Params:", nftParams);
        console.log("Datatoken Params:", datatokenParams);

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

// Metadata encryption endpoint
router.post('/encrypt-metadata', async (req, res) => {
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

        // Prepare `Files` object
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

        // Encrypt the files
        fixedDDO.services[0].files = await ProviderInstance.encrypt(
            Files,
            oceanConfig.chainId,
            oceanConfig.providerUri
        );
        fixedDDO.services[0].datatokenAddress = datatokenAddress;

        // Encrypt the full DDO
        const encryptedDDO = await ProviderInstance.encrypt(
            fixedDDO,
            oceanConfig.chainId,
            oceanConfig.providerUri
        );

        // Validate with Aquarius
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
            0,                                               // _metaDataState
            oceanConfig.providerUri,                         // _metaDataDecryptorUrl
            '0x123',                                        // _metaDataDecryptorAddress
            '0x02',                                         // flags
            encryptedDDO,                                   // data
            metadataHash,                                   // _metaDataHash
            []                                              // additionalParams
        ]);

        // Estimate gas
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

module.exports = router;
