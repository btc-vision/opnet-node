console.log('running.');

process.on('message', (message) => {
    console.log('Message from parent:', message);
});
