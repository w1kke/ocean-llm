const { ChatOpenAI } = require('@langchain/openai');
const { HumanMessage, SystemMessage } = require('@langchain/core/messages');
const fetch = require('node-fetch');
const { uploadToIPFS } = require('./ipfs');
const ethers = require('ethers');

const chat = new ChatOpenAI({
    openAIApiKey: process.env.OPENAI_API_KEY,
    temperature: 0.7
});

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

async function fetchUserAssets(address, chainId) {
    try {
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
        return { success: true, assets: data.hits.hits };
    } catch (error) {
        console.error('Error fetching user assets:', error);
        throw error;
    }
}

module.exports = {
    generateMetadata,
    generateAndUploadPreviewImage,
    fetchUserAssets
};
