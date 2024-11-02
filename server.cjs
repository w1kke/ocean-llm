require('blob-polyfill');
const { app, PORT } = require('./server/config');
const apiRoutes = require('./server/routes/api');
const indexRoutes = require('./server/routes/index');

// Use routes
app.use('/api', apiRoutes);
app.use('/', indexRoutes);

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
