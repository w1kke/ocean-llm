const express = require('express');
const router = express.Router();
const { handleFileUpload } = require('../ipfs');
const { generateMetadata, generateAndUploadPreviewImage, fetchUserAssets } = require('../metadata');
const { nftAbi, initializeOcean, calculateDID, ZERO_ADDRESS, NftFactory, ProviderInstance, Aquarius, getHash, ethers } = require('../ocean');
const { debug } = require('../config');
const TokenFetcher = require('../tokenfetcher');
const fetch = require('node-fetch');
//const { Provider } = require('@oceanprotocol/lib');
const { hasUserPurchased, getUserOrders } = require('../subgraph');



router.get('/nft-access/:address/:chainId', async (req, res) => {
    try {
        const { address, chainId } = req.params;
        const oceanConfig = await initializeOcean();
        const provider = new ethers.providers.JsonRpcProvider(oceanConfig.nodeUri);
        
        // Initialize TokenFetcher
        const tokenFetcher = new TokenFetcher(provider, oceanConfig.dispenserAddress);
        
        // Batch fetch tokens and Aquarius data in parallel
        const [tokenResult, aquariusBaseUrl] = await Promise.all([
            tokenFetcher.getTokensAndTransfers(address),
            'https://v4.aquarius.oceanprotocol.com/api/aquarius/assets/ddo/'
        ]);

        // Prepare batch request to Aquarius
        const dids = tokenResult.tokens.map(nft => calculateDID(nft.erc721Address, chainId));
        
        // Fetch all metadata in parallel with a concurrency limit
        const BATCH_SIZE = 5;
        const aquariusData = new Map();
        
        for (let i = 0; i < dids.length; i += BATCH_SIZE) {
            const batch = dids.slice(i, i + BATCH_SIZE);
            const responses = await Promise.all(
                batch.map(did => 
                    fetch(aquariusBaseUrl + did)
                        .then(res => res.json())
                        .catch(() => null)
                )
            );
            
            responses.forEach((data, index) => {
                if (data && !data.error) {
                    aquariusData.set(batch[index], data);
                }
            });
        }

        // Process NFT info using the cached Aquarius data
        const nftInfo = tokenResult.tokens.map(nft => {
            const did = calculateDID(nft.erc721Address, chainId);
            const aquariusMetadata = aquariusData.get(did);

            // Base NFT info
            const baseNftInfo = {
                ...nft,
                nftAddress: nft.erc721Address,
                did,
                currentBalance: ethers.utils.formatUnits(nft.balance, nft.decimals),
                accessType: 'dispenser',
                status: 'active',
                datatokenAddress: aquariusMetadata?.services?.[0]?.datatokenAddress || nft.datatokenAddress
            };

            // Return enhanced info if available, otherwise return base info
            return aquariusMetadata ? {
                ...baseNftInfo,
                name: aquariusMetadata.metadata.name,
                symbol: aquariusMetadata.metadata.symbol,
                description: aquariusMetadata.metadata.description,
                author: aquariusMetadata.metadata.author,
                created: aquariusMetadata.metadata.created,
                updated: aquariusMetadata.metadata.updated,
                owner: aquariusMetadata.nft.owner,
                previewImageUrl: Array.isArray(aquariusMetadata.metadata.links) ? 
                    aquariusMetadata.metadata.links[0] || null : null,
                tags: aquariusMetadata.metadata.tags,
                additionalInformation: aquariusMetadata.metadata.additionalInformation,
                datatokenAddress: aquariusMetadata.services[0]?.datatokenAddress || nft.datatokenAddress
            } : baseNftInfo;
        });

        // Filter accessible NFTs (moved filtering logic to a separate function for clarity)
        const accessibleNfts = nftInfo.filter(nft => {
            const hasBalance = parseFloat(nft.currentBalance) > 0;
            const hasTransfers = nft.transfers?.length > 0;
            return hasBalance || hasTransfers;
        });

        res.json({
            success: true,
            accessibleNfts,
            message: `Found ${accessibleNfts.length} accessible NFTs`
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
        
        // Fetch current DDO from Aquarius
        const did = calculateDID(nftAddress, oceanConfig.chainId);
        const aquarius = new Aquarius(oceanConfig.metadataCacheUri);
        const currentDDO = await aquarius.resolve(did);
        
        if (!currentDDO) {
            throw new Error('Could not fetch current DDO from Aquarius');
        }

        // Update DDO metadata
        currentDDO.metadata.status = 'revoked';
        currentDDO.metadata.state = 3; // Revoked by publisher
        currentDDO.metadata.updated = new Date().toISOString();
        
        // Add revocation info
        currentDDO.metadata.revocation = {
            reason: 'Asset deleted by publisher',
            date: new Date().toISOString()
        };

        // Encrypt the updated DDO
        const encryptedDDO = await ProviderInstance.encrypt(
            currentDDO,
            oceanConfig.chainId,
            oceanConfig.providerUri
        );

        // Convert encrypted DDO to hex string if it isn't already
        const encryptedDDOHex = ethers.utils.isHexString(encryptedDDO) 
            ? encryptedDDO 
            : ethers.utils.hexlify(ethers.utils.toUtf8Bytes(JSON.stringify(encryptedDDO)));

        // Calculate metadata hash
        const metadataHash = ethers.utils.keccak256(
            ethers.utils.toUtf8Bytes(JSON.stringify(currentDDO))
        );

        // Prepare transaction data using NFT ABI
        const nftInterface = new ethers.utils.Interface(nftAbi);
        const txData = nftInterface.encodeFunctionData("setMetaData", [
            3,                                    // _metaDataState (3 for revoked)
            oceanConfig.providerUri || '',        // _metaDataDecryptorUrl
            oceanConfig.providerAddress || '0x0', // _metaDataDecryptorAddress
            '0x02',                              // flags (unchanged)
            encryptedDDOHex,                     // encrypted DDO data
            metadataHash,                        // _metaDataHash
            []                                   // additionalParams (empty array for basic revocation)
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
        res.status(500).json({ 
            success: false, 
            error: error.message,
            details: error.stack
        });
    }
});




router.post('/consume-asset', async (req, res) => {
    try {
        const { nftAddress, datatokenAddress, userAddress, chainId } = req.body;
        const oceanConfig = await initializeOcean();
        const provider = new ethers.providers.JsonRpcProvider(oceanConfig.nodeUri);
        const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
        
        const transactions = [];

        // Get asset details from Aquarius first
        const did = calculateDID(nftAddress, chainId);
        const aquarius = new Aquarius(oceanConfig.metadataCacheUri);
        const asset = await aquarius.resolve(did);
        
        if (!asset) {
            throw new Error('Asset not found in Aquarius');
        }

        // Find the download service
        const downloadService = asset.services.find(s => s.type === 'access');
        if (!downloadService) {
            throw new Error('No download service found for this asset');
        }

        // Check if user has already purchased this datatoken
        const hasPurchased = await hasUserPurchased(userAddress, datatokenAddress, chainId);
        console.log('[DEBUG] Purchase check:', { userAddress, datatokenAddress, hasPurchased });

        if (hasPurchased) {
            // Get the most recent order tx for this datatoken
            const orders = await getUserOrders(userAddress, chainId);
            const matchingOrder = orders.find(order => 
                order.datatoken.address.toLowerCase() === datatokenAddress.toLowerCase()
            );
        
            return res.json({
                success: true,
                did,
                serviceId: downloadService.id,
                serviceIndex: downloadService.index || 0,
                transactions: [], // No transactions needed
                providerUri: oceanConfig.providerUri,
                hasValidOrder: true,
                orderTxId: matchingOrder.tx, // Include the transaction ID from subgraph
                downloadService: {
                    type: downloadService.type,
                    fileIndex: 0
                }
            });
        }

        // Check datatoken balances
        const datatokenAbi = [
            'function balanceOf(address account) view returns (uint256)',
            'function mint(address account, uint256 amount)',
            'function startOrder(address consumer, uint256 serviceIndex, tuple(address providerFeeAddress, address providerFeeToken, uint256 providerFeeAmount, uint8 v, bytes32 r, bytes32 s, uint256 validUntil, bytes providerData) _providerFee, tuple(address consumeMarketFeeAddress, address consumeMarketFeeToken, uint256 consumeMarketFeeAmount) _consumeMarketFee)'
        ];

        const datatokenContract = new ethers.Contract(
            datatokenAddress,
            datatokenAbi,
            provider
        );

        // Check both dispenser and user balance in parallel
        const [dispenserBalance, userBalance] = await Promise.all([
            datatokenContract.balanceOf(oceanConfig.dispenserAddress),
            datatokenContract.balanceOf(userAddress)
        ]);

        console.log('[DEBUG] Dispenser balance:', dispenserBalance.toString());
        console.log('[DEBUG] User balance:', userBalance.toString());

        // If neither dispenser nor user has tokens, we need to mint
        if (dispenserBalance.lt(ethers.utils.parseEther('1')) && userBalance.lt(ethers.utils.parseEther('1'))) {
            console.log('[DEBUG] Adding mint transaction for dispenser');
            const mintTx = {
                message: 'Minting tokens to dispenser...',
                data: {
                    to: datatokenAddress,
                    data: datatokenContract.interface.encodeFunctionData('mint', [
                        oceanConfig.dispenserAddress,
                        ethers.utils.parseEther('1')
                    ]),
                    gasLimit: '300000'
                }
            };
            transactions.push(mintTx);
        }

        // Only add dispense transaction if user needs tokens
        if (userBalance.lt(ethers.utils.parseEther('1'))) {
            const dispenserContract = new ethers.Contract(
                oceanConfig.dispenserAddress,
                ['function dispense(address datatoken, uint256 amount, address destination)'],
                provider
            );

            const dispenseTx = {
                message: 'Getting tokens from dispenser...',
                data: {
                    to: oceanConfig.dispenserAddress,
                    data: dispenserContract.interface.encodeFunctionData('dispense', [
                        datatokenAddress,
                        ethers.utils.parseEther('1'),
                        userAddress
                    ]),
                    gasLimit: '300000'
                }
            };
            transactions.push(dispenseTx);
        }

        // Initialize provider with correct service details
        const initializeData = await ProviderInstance.initialize(
            asset.id,
            downloadService.id,
            0,
            userAddress,
            oceanConfig.providerUri
        );

        // Construct the provider fee and consume market fee objects
        const providerFee = {
            providerFeeAddress: initializeData.providerFee.providerFeeAddress,
            providerFeeToken: initializeData.providerFee.providerFeeToken,
            providerFeeAmount: initializeData.providerFee.providerFeeAmount,
            v: initializeData.providerFee.v,
            r: initializeData.providerFee.r,
            s: initializeData.providerFee.s,
            validUntil: initializeData.providerFee.validUntil || 0,
            providerData: initializeData.providerFee.providerData
        };

        const consumeMarketFee = {
            consumeMarketFeeAddress: oceanConfig.consumeMarketFeeAddress || ZERO_ADDRESS,
            consumeMarketFeeToken: ZERO_ADDRESS,
            consumeMarketFeeAmount: 0
        };

        // Add start order transaction
        const orderTx = {
            message: 'Starting order...',
            data: {
                to: datatokenAddress,
                data: datatokenContract.interface.encodeFunctionData('startOrder', [
                    userAddress,
                    downloadService.index || 0,
                    providerFee,
                    consumeMarketFee
                ]),
                gasLimit: '500000'
            }
        };
        transactions.push(orderTx);

        // Estimate gas for all transactions
        const gasEstimates = await Promise.all(
            transactions.map(tx => 
                provider.estimateGas({
                    to: tx.data.to,
                    data: tx.data.data,
                    from: userAddress
                }).catch(() => ethers.BigNumber.from(tx.data.gasLimit))
            )
        );

        // Update gas limits with estimates plus 20% buffer
        transactions.forEach((tx, index) => {
            tx.data.gasLimit = '0x' + gasEstimates[index]
                .mul(12).div(10)  // Add 20% buffer
                .toHexString().slice(2);
        });

        res.json({
            success: true,
            did,
            serviceId: downloadService.id,
            serviceIndex: downloadService.index || 0,
            transactions,
            providerUri: oceanConfig.providerUri,
            hasTokens: !userBalance.isZero(),
            downloadService: {
                type: downloadService.type,
                fileIndex: 0,
                // Add any other relevant download service info
            }
        });

    } catch (error) {
        console.error('Error preparing consume transaction:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            details: error.stack
        });
    }
});

router.post('/get-download-url', async (req, res) => {
    try {
        const { did, serviceId, orderTxId, userAddress, fileIndex } = req.body;
        const oceanConfig = await initializeOcean();
        
        // Get provider endpoints
        const providerEndpoints = await ProviderInstance.getEndpoints(oceanConfig.providerUri);
        const serviceEndpoints = await ProviderInstance.getServiceEndpoints(
            oceanConfig.providerUri, 
            providerEndpoints
        );

        // Get nonce
        const nonce = (await ProviderInstance.getNonce(
            oceanConfig.providerUri,
            userAddress,
            null,
            providerEndpoints,
            serviceEndpoints
        ) + 1).toString();

        // Get download URL endpoint
        const downloadEndpoint = ProviderInstance.getEndpointURL(serviceEndpoints, 'download');
        if (!downloadEndpoint) throw new Error('Download service not found');

        res.json({
            success: true,
            did,
            serviceId,
            nonce,
            providerUrl: oceanConfig.providerUri,
            downloadUrl: downloadEndpoint.urlPath,
            fileIndex
        });

    } catch (error) {
        console.error('Error getting download URL:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});


module.exports = router;