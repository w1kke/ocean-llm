const { NftFactory, ConfigHelper, ProviderInstance, Aquarius, getHash, ZERO_ADDRESS} = require('@oceanprotocol/lib');
const ethers = require('ethers');
const { debug } = require('./config');

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
        FixedPrice: baseConfig.FixedPrice,
    };
}

function calculateDID(nftAddress, chainId) {
    const CryptoJS = require('crypto-js');
    const checksum = CryptoJS.SHA256(nftAddress + chainId.toString(10)).toString(CryptoJS.enc.Hex);
    return `did:op:${checksum}`;
}

module.exports = {
    nftAbi,
    initializeOcean,
    calculateDID,
    ZERO_ADDRESS,
    NftFactory,
    ProviderInstance,
    Aquarius,
    getHash,
    ethers
};
