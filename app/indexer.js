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
    _filesTableFilterErrors = document.querySelector('[id="filesTableFilterErrors"]'),
    _filesTableFilterAll = document.querySelector('[id="filesTableFilterAll"]'),
    _title = document.querySelector('title'),
    _pathHelper = require('./lib/pathHelper'),
    _updateFileCountLabel = require('./lib/ui/fileCountLabel'),
    _updateErrorLogLink = require('./lib/ui/errorLogLink'),
    _dataFolder = _path.join(_electron.remote.app.getPath('appData'), 'myStreamCCIndexer'),
    FileWatcher = require('./lib/fileWatcher'),
    _fileWatcher = null,
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
(async function(){
    
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
    _removeScanFolder.addEventListener('click', async function(){
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
        fillFileTable();
        await setStateBasedOnScanFolder();
    }, false);

    //
    _focusSettings.addEventListener('click', function() {
        window.__glu_verticalTabs['mainTabs'].focusNamed('settings')
    });

    // binds scan folder
    _btnSelectRoot.addEventListener('click', async function(){
        const folder = _dialog.showOpenDialog({
            properties: ['openDirectory']
        });

        if (folder && folder.length)
            setStorageRootFolder(_pathHelper.toUnixPath(folder[0]));

        await setStateBasedOnScanFolder();
        // force dirty to rescan
        _fileWatcher.dirty = true;
    }, false);

    _filesTableFilterErrors.addEventListener('change', function() {
        fillFileTable();
    });
    
    _filesTableFilterAll.addEventListener('change', function() {
        fillFileTable();
    });

    _cbAutostart.addEventListener('change', function() {
        _config.set('autoStart', _cbAutostart.checked);

        if (_cbAutostart.checked)
            _autoLaunch.enable();
        else
            _autoLaunch.disable();
    });

    _cbStartMinimized.addEventListener('change', function() {
        _config.set('startMinimized', _cbStartMinimized.checked);
    });

    _btnReindex.addEventListener('click', async function() {
         // force rescan and dirty
        await _fileWatcher.rescan(true);
    }, false);

    bindMainWindowEvents();

    _electron.remote.app.on('ready', function() {
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

    var attempts = 0,
    mainWindowFindTimer = setInterval(function(){
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

            _mainWindow.on('minimize',function(e){
                e.preventDefault();
                _mainWindow.hide();
            });
        
            _mainWindow.on('close', function (e) {
                if( !_electron.remote.app.isQuiting){
                    e.preventDefault();
                    _mainWindow.hide();
                }
                return false;
            });

            // hide menu
            mainWindow.setMenu(null)

            // autohide indexer on start, this isn't the best way of doing it
            // as you can still see app starting
            if (_isStartMinimized)
                mainWindow.hide();
        

        }
        
    }, 500);

}


/**
 * 
 */
function setStatus(status){
    //_status.innerHTML = status;
    if (status)
        status = ` - ${status}`;
    _title.innerHTML = `myStream Indexer${status}`;
}


/**
 * Renders the table showing all files found
 */
function fillFileTable(){
    if (!_fileIndexer){
        _allFilesTable.innerHTML = '';
        return;
    }
        
    const selectedFilter = document.querySelector('[name="filesTableFilter"]:checked').value;
    var allFiles = _fileIndexer.getAllFiles(),
        errors = 0,
        count = 1,
        html = '';

    for (let file of allFiles){
        if (!file.isValid)
            errors ++;   

        if (selectedFilter === 'errors' && file.isValid)
            continue;

        let filePath = file.file,
            errorClass = file.isValid ? '' : 'allFilesTableRow--error';

        if (_storageRootFolder)
            filePath = filePath.substring(_storageRootFolder.length);

        html += `<li class="allFilesTableRow ${errorClass}">${count} - ${filePath}</li>`;
        count++;
    }

    _allFilesTable.innerHTML = html;

    _updateFileCountLabel(allFiles, selectedFilter, errors);
    _updateErrorLogLink(errors, _fileIndexer.logPath);
    // error log link


}


/**
 * Does final setup stuff when app is ready
 */
function onAppReady(){
    _tray = new _Tray(__dirname + '/resources/windows/icon.ico');

    var contextMenu = _menu.buildFromTemplate([
        {label: 'Show', click:  function() {
            _mainWindow.show();
        } },
        {label: 'Quit', click:  function(){
            _electron.remote.app.isQuiting = true;
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

async function handleIndexinStart(){
    _btnReindex.classList.add('button--disable');
}

async function handleIndexinDone(){
    _btnReindex.classList.remove('button--disable');
    fillFileTable();
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
    _fileIndexer.onIndexing(handleIndexinStart)
    _fileIndexer.onIndexed(handleIndexinDone)
    _fileIndexer.onStatus(handleStatus);
    await _fileIndexer.start();
}