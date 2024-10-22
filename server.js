import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const PORT = 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/node_modules', express.static(path.join(__dirname, 'node_modules')));
app.use(express.json());

async function processMessage(message) {
    return `You said: "${message}". This is a placeholder response.`;
}

app.post('/api/chat', async (req, res) => {
    const { message } = req.body;
    try {
        const response = await processMessage(message);
        res.json({ response });
    } catch (error) {
        console.error('Error processing message:', error);
        res.status(500).json({ error: 'Failed to process message' });
    }
});

app.get('/', (req, res) => {
    res.render('index');
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});