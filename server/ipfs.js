const fetch = require('node-fetch');
const FormData = require('form-data');
const { Buffer } = require('buffer');

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

async function handleFileUpload(req, res) {
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
}

module.exports = {
    uploadToIPFS,
    handleFileUpload
};
