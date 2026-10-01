const { app, dialog } = require('../index.js');

app.whenReady().then(async () => {
    console.log('--- Adrenaline Dialog Demo ---');

    // 1. Message Box
    console.log('Displaying Message Box...');
    const boxResult = await dialog.showMessageBox({
        type: 'info',
        title: 'Welcome',
        message: 'Welcome to Adrenaline Native Dialogs!',
        detail: 'This is a native message box running asynchronously.',
        buttons: ['OK', 'Cancel'],
        checkboxLabel: 'Do not ask again',
        checkboxChecked: false
    });
    console.log('MessageBox Result:', boxResult);

    // 2. Show Open Dialog
    console.log('Opening File Dialog...');
    const openResult = await dialog.showOpenDialog({
        title: 'Select Code Files',
        buttonLabel: 'Select',
        filters: [
            { name: 'JavaScript Files', extensions: ['js', 'json'] },
            { name: 'All Files', extensions: ['*'] }
        ],
        properties: ['openFile', 'multiSelections']
    });
    console.log('OpenDialog Result:', openResult);

    // 3. Show Save Dialog
    console.log('Opening Save Dialog...');
    const saveResult = await dialog.showSaveDialog({
        title: 'Save File As',
        buttonLabel: 'Save File',
        filters: [
            { name: 'Text Documents', extensions: ['txt'] }
        ]
    });
    console.log('SaveDialog Result:', saveResult);

    process.exit(0);
});
