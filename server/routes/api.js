const express = require('express');
const router = express.Router();
const { handleFileUpload } = require('../ipfs');
const { generateMetadata, generateAndUploadPreviewImage, fetchUserAssets } = require('../metadata');
const { nftAbi, initializeOcean, calculateDID, ZERO_ADDRESS, NftFactory, ProviderInstance, Aquarius, getHash, ethers } = require('../ocean');
const { debug } = require('../config');
const TokenFetcher = require('../tokenfetcher');

// NFT Access endpoint
router.get('/nft-access/:address/:chainId', async (req, res) => {
    try {
        const { address, chainId } = req.params;
        const oceanConfig = await initializeOcean();
        const provider = new ethers.providers.JsonRpcProvider(oceanConfig.nodeUri);
        
        const tokenFetcher = new TokenFetcher(provider, oceanConfig.dispenserAddress);
        const result = await tokenFetcher.getTokensAndTransfers(address);

        // For each NFT, fetch additional information from the subgraph
        const nftInfo = await Promise.all(
            result.tokens.map(async (nft) => {
                try {
                    // Query the subgraph for NFT information
                    const subgraphUrl = oceanConfig.subgraphUri;
                    const query = `
                        {
                            nft(id: "${nft.address.toLowerCase()}") {
                                symbol
                                name
                                owner {
                                    id
                                }
                                created
                                nftData {
                                    metadataState
                                    metadataDecryptorUrl
                                }
                            }
                        }
                    `;

                    const response = await fetch(subgraphUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ query })
                    });

                    const data = await response.json();
                    
                    // Even if we don't get subgraph data, return the token as an NFT
                    // since it's been verified by TokenFetcher
                    const baseNftInfo = {
                        ...nft,
                        did: calculateDID(nft.address, chainId),
                        currentBalance: ethers.utils.formatUnits(nft.balance, nft.decimals),
                        accessType: 'dispenser',  // Add this to indicate it's a dispenser-based access
                        status: 'active'  // Add this to show it's an active token
                    };

                    // If we have subgraph data, enhance the NFT info
                    if (data.data?.nft) {
                        const nftData = data.data.nft;
                        return {
                            ...baseNftInfo,
                            name: nftData.name || nft.name,
                            symbol: nftData.symbol || nft.symbol,
                            owner: nftData.owner?.id,
                            created: nftData.created,
                            metadataState: nftData.nftData?.metadataState,
                            metadataUrl: nftData.nftData?.metadataDecryptorUrl
                        };
                    }

                    // If no subgraph data, return the base NFT info
                    console.log(`Using token data for NFT ${nft.address}`);
                    return baseNftInfo;

                } catch (error) {
                    console.error(`Error fetching NFT info for ${nft.address}:`, error);
                    // Still return the token as an NFT even if there's an error
                    return {
                        ...nft,
                        did: calculateDID(nft.address, chainId),
                        currentBalance: ethers.utils.formatUnits(nft.balance, nft.decimals),
                        accessType: 'dispenser',
                        status: 'active'
                    };
                }
            })
        );

        res.json({
            success: true,
            accessibleNfts: nftInfo.filter(nft => parseFloat(nft.currentBalance) > 0),  // Only show NFTs with balance
            message: `Found ${nftInfo.length} accessible NFTs`
        });

    } catch (error) {
        console.error('Error fetching NFT access:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

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
        const { nftAddress, datatokenAddress, metadata, chainId, publisherAddress } = req.body;

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


router.post('/prepare-nft-delete', async (req, res) => {
    try {
        const { nftAddress, userAddress } = req.body;
        const oceanConfig = await initializeOcean();
        const provider = new ethers.providers.JsonRpcProvider(oceanConfig.nodeUri);
        
        // Create empty DDO for deletion
        const emptyDDO = {
            '@context': ['https://w3id.org/did/v1'],
            version: '4.1.0',
            metadata: {
                deleted: true,
                type: 'dataset'
            }
        };

        // Encrypt the empty DDO
        const encryptedDDO = await ProviderInstance.encrypt(
            emptyDDO,
            oceanConfig.chainId,
            oceanConfig.providerUri
        );

        // Calculate metadata hash
        const rawHash = getHash(JSON.stringify(emptyDDO));
        const metadataHash = rawHash.startsWith('0x') ? rawHash : `0x${rawHash}`;

        // Create the transaction data for setMetaData with state 1 (deleted)
        const nftInterface = new ethers.utils.Interface(nftAbi);
        const txData = nftInterface.encodeFunctionData("setMetaData", [
            1,                                  // _metaDataState (1 = deleted)
            oceanConfig.providerUri,            // _metaDataDecryptorUrl
            '0x123',                           // _metaDataDecryptorAddress
            '0x02',                            // flags
            encryptedDDO,                      // data (encrypted empty DDO)
            metadataHash,                      // _metaDataHash
            []                                 // additionalParams
        ]);

        // Estimate gas
        const gasEstimate = await provider.estimateGas({
            to: nftAddress,
            data: txData,
            from: userAddress
        });

        // Add 20% buffer to gas estimate
        const gasLimitHex = '0x' + gasEstimate.mul(12).div(10).toHexString().slice(2);

        res.json({
            success: true,
            transaction: {
                to: nftAddress,
                data: txData,
                gasLimit: gasLimitHex
            }
        });
    } catch (error) {
        console.error('Error preparing NFT deletion:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
