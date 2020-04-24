'use strict';

let 
    _path = require('path'),
    _process =require('process'),
    _AutoLaunch = require('auto-launch'),
    _fs = require('fs-extra'),
    _electron = require('electron'),
    _Config = require('electron-config'),
    _btnReindex = document.querySelector('.btnReindex'),
    _btnSelectRoot = document.querySelector('.btnSelectRoot'),
    _pathSelectedContent = document.querySelector('.pathSelectedContent'),
    _scanFolderDisplay = document.querySelector('.scanFolder'),
    _removeScanFolder = document.querySelector('.removeScanFolder'),
    _cbAutostart = document.querySelector('.cbAutostart'),
    _allFilesTable = document.querySelector('.allFilesTable'),
    _cbStartMinimized = document.querySelector('.cbStartMinimized'),
    _scanFolderWrapper = document.querySelector('.scanFolderWrapper'),
    _noScanFolderContent = document.querySelector('.layout-musicDisabled'),
    _scanFolderSelectedContent = document.querySelector('.layout-musicEnabled'),
    _focusSettings = document.querySelector('.focusSettings'),
    _title = document.querySelector('title'),
    _sago = require('s-ago'),
    _lastIndexTime = null, // datetime 
    _pathHelper = require('./lib/pathHelper'),
    _updateFileCountLabel = require('./lib/ui/fileCountLabel'),
    _updateErrorLogLink = require('./lib/ui/errorLogLink'),
    _dataFolder = _path.join(_electron.remote.app.getPath('appData'), 'myStreamCCIndexer'),
    FileWatcher = require('./lib/fileWatcher'),
    _fileWatcher = null,
    _indexStart = null, // datetime
    FileIndexer = require('./lib/fileIndexer'),
    _fileIndexer = null,
    _mainWindow,
    _Tray = _electron.remote.Tray,
    _menu = _electron.remote.Menu,
    _dialog = _electron.remote.dialog,
    _config = new _Config(),
    _autoLaunch = new _AutoLaunch({ name: 'myStreamIndexer' }),
    _storageRootFolder = _config.get('storageRoot'),
    _isAutostarting = _config.get('autoStart'),
    _isStartMinimized = _config.get('startMinimized'),
    _tray = null;    


// starts things up
(async()=>{
    
    await _fs.ensureDir(_dataFolder);

    // set state of "auto start" checkbox
    if (_isAutostarting === undefined || _isAutostarting === null){
        _isAutostarting = false;
    }

    _cbAutostart.checked = _isAutostarting;

    if (_isStartMinimized === undefined || _isStartMinimized === null)
        _isStartMinimized = false;
    _cbStartMinimized.checked = _isStartMinimized;

    // set autostart service for next time app starts
    if (_isAutostarting)
        _autoLaunch.enable();
    else
        _autoLaunch.disable();

    await setStateBasedOnScanFolder();
    await fillFileTable();



    // bind UI event handlers

    // unbinds scan folder
    _removeScanFolder.addEventListener('click', async ()=>{
        const approved = _dialog.showMessageBox({
            type: 'question',
            buttons: ['No', 'Yes'],
            title: 'Confirm',
            message: 'Are you sure you want to unbind this folder? (You can always rebind it again)'
        });

        if(!approved)
            return;

        // clean this p
        await _fileIndexer.wipe();
        setStorageRootFolder(null);
        await fillFileTable();
        await setStateBasedOnScanFolder();
    }, false);

    //
    _focusSettings.addEventListener('click', ()=>{
        window.__glu_verticalTabs['mainTabs'].focusNamed('settings')
    });

    // binds scan folder
    _btnSelectRoot.addEventListener('click', async ()=>{
        const folder = _dialog.showOpenDialog({
            properties: ['openDirectory']
        });

        if (folder && folder.length)
            setStorageRootFolder(_pathHelper.toUnixPath(folder[0]));

        await setStateBasedOnScanFolder();
        // force dirty to rescan
        _fileWatcher.dirty = true;
    }, false);

    _cbAutostart.addEventListener('change', ()=>{
        _config.set('autoStart', _cbAutostart.checked);

        if (_cbAutostart.checked)
            _autoLaunch.enable();
        else
            _autoLaunch.disable();
    });

    _cbStartMinimized.addEventListener('change', ()=>{
        _config.set('startMinimized', _cbStartMinimized.checked);
    });

    _btnReindex.addEventListener('click', async()=>{
         // force rescan and dirty
        await _fileWatcher.rescan(true);
    }, false);

    bindMainWindowEvents();

    _electron.remote.app.on('ready', ()=>{
        onAppReady();
    });

    if (_electron.remote.app.isReady()){
        onAppReady();
    }
    
})();


/** 
 * Bind all mainWindow stuff here, mainWindow is finicky to retrieve on dev environments, I'm
 * assuming because it doesn't have focus over the console window, so getFocusWindow returns 
 * null. 
 */
function bindMainWindowEvents(){

    let attempts = 0,
        mainWindowFindTimer = setInterval(()=>{
            attempts ++;

            var mainWindow,
                allwindows = _electron.remote.BrowserWindow.getAllWindows();

            if (allwindows && allwindows.length === 1)
                mainWindow = allwindows[0];
        
            if (!mainWindow)
                mainWindow = _electron.remote.BrowserWindow.getFocusedWindow(); 

            if (mainWindow || attempts > 20){
                clearInterval(mainWindowFindTimer);
                _mainWindow = mainWindow;
                
                // if main window still wasn't found, kill app and exit, we can't recover from this
                if (!mainWindow)
                    return _process.exit(1);

                _mainWindow.on('minimize',(e)=>{
                    e.preventDefault();
                    _mainWindow.hide();
                });
                
                // always hide app on close, actual closing is done from system tray
                _mainWindow.on('close', (e)=>{
                    e.preventDefault();
                    _mainWindow.hide();
                    return false;
                });

                // hide menu
                _mainWindow.setMenu(null)

                // autohide indexer on start, this isn't the best way of doing it
                // as you can still see app starting
                if (_isStartMinimized)
                    _mainWindow.hide();
            }
            
        }, 500);

}


/**
 * 
 */
function setStatus(status){
    if (status)
        status = ` - ${status}`;

    _title.innerHTML = `myStream Indexer${status}`;
}


/**
 * Renders the table showing all files found
 */
async function fillFileTable(){
    if (!_fileIndexer){
        _allFilesTable.innerHTML = '';
        return;
    }
        
    var allFiles = _fileIndexer.getAllFiles(),
        errors = 0,
        count = 1,
        html = '';

    _updateFileCountLabel(allFiles);


    errors = allFiles.filter(file => !file.isValid).length;
    allFiles = allFiles.sort((a,b) => a.mtime > b.mtime);
    allFiles = allFiles.slice(0, 10);

    if (allFiles.length)
        html += `<li class="allFilesTableRow allFilesTa_bleRow--error">${allFiles.length} most recent changes</li>`;

    for (let file of allFiles){
        let filePath = file.file;

        if (_storageRootFolder)
            filePath = filePath.substring(_storageRootFolder.length);

        html += `<li class="allFilesTableRow allFilesTa_bleRow--error">${count} - ${filePath} (${_sago(new Date(file.mtime))})</li>`;
        count++;
    }

    if (_fileIndexer ){
        const lastIndexDate = await _fileIndexer.getLastIndexDate();
        if (lastIndexDate){
            document.querySelector('.lastReindexTime').innerHTML = `Last indexed ${_sago(lastIndexDate)}`;
        }
    }
        

    _allFilesTable.innerHTML = html;

    _updateErrorLogLink(errors, _fileIndexer.logPath);
}


/**
 * Does final setup stuff when app is ready
 */
function onAppReady(){
    _tray = new _Tray(__dirname + '/resources/windows/icon.ico');

    var contextMenu = _menu.buildFromTemplate([
        {label: 'Show', click:  ()=> {
            _mainWindow.show();
        } },
        {label: 'Quit', click:  async()=>{

            await _electron.ipcRenderer.send('real-death', true);
            _electron.remote.app.quit();
        } }
    ]);

    _tray.setToolTip('myStream.cc Indexer');
    _tray.setContextMenu(contextMenu);
}


/** 
 * The only place we set storageFolder.
 */
function setStorageRootFolder(folder){
    _storageRootFolder = folder;
    _config.set('storageRoot', folder);
}

async function handleIndexStart(){
    _indexStart = new Date()
    _btnReindex.innerHTML = 'Reindexing';
    document.querySelector('body').classList.add('body--disabled');
    setStatus('Searching ...');
}

async function handleIndexinDone(){
    const lapsed = new Date().getTime() - _indexStart.getTime(),
        minTime = 3000;

    setTimeout(async ()=> {
        _btnReindex.innerHTML = 'Reindex';
        document.querySelector('body').classList.remove('body--disabled');
        await fillFileTable();
        _lastIndexTime = new Date();
    }, lapsed < minTime ? minTime - lapsed : 0);

}

async function handleStatus(status){
    setStatus(status)
}

/**
 * Initialize watcher for file changes. This happens on app start, and when a new watch
 * folder is selected.
 */
async function setStateBasedOnScanFolder(){
    // force defaults
    _scanFolderWrapper.style.visibility = 'hidden';
    _pathSelectedContent.style.visibility = 'hidden';
    _scanFolderWrapper.style.visibility = 'hidden';
    _noScanFolderContent.style.display = 'block';
    _scanFolderSelectedContent.style.display = 'none';

    if (!_storageRootFolder)
        return;

    _scanFolderSelectedContent.style.display = 'block';
    _noScanFolderContent.style.display = 'none';
    _pathSelectedContent.style.visibility = 'visible';
    _scanFolderWrapper.style.visibility = 'visible';
    _scanFolderDisplay.innerHTML = _storageRootFolder;


    _fileWatcher = new FileWatcher(_storageRootFolder);
    _fileWatcher.onStatusChange(handleStatus);
    await _fileWatcher.start();

    if (_fileIndexer)
        _fileIndexer.dispose();

    _fileIndexer = new FileIndexer(_fileWatcher);
    _fileIndexer.onIndexing(handleIndexStart)
    _fileIndexer.onIndexed(handleIndexinDone)
    _fileIndexer.onStatus(handleStatus);
    await _fileIndexer.start();
}