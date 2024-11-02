require('dotenv').config();
const express = require('express');
const fileUpload = require('express-fileupload');

const app = express();
const PORT = process.env.PORT || 3000;

// Configure express
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

module.exports = {
    app,
    PORT,
    debug
};
